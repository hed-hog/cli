import chalk = require('chalk');
import { AbstractAction } from '.';
import { Input } from '../commands';
import path = require('path');
import { createService } from '../lib/utils/create-service';
import { createController } from '../lib/utils/create-controller';
import * as yaml from 'yaml';
import { readFileSync } from 'fs';
import { createModule } from '../lib/utils/create-module';
import { createDTOs } from '../lib/utils/create-dto';
import { readFile, writeFile } from 'fs/promises';
import { prettier } from '../lib/utils/formatting';
import { pluralize } from '../lib/utils/pluralize';
import {
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from '../lib/utils/convert-string-cases';
import { getRootPath } from '../lib/utils/get-root-path';

interface Column {
  name: string;
  type: string;
  length?: number;
  isPrimary: boolean;
  references?: {
    table: string;
    column: string;
    onDelete: string;
  };
}

interface Table {
  name: string;
  columns: Column[];
  ifNotExists: boolean;
}

export class ApplyAction extends AbstractAction {
  public async handle(inputs: Input[]) {
    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    if (!libraryName.length) {
      console.error(chalk.red('You must tell a name for the module.'));
      process.exit(1);
    }

    if (/\s/.test(libraryName)) {
      console.error(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    const rootPath = await getRootPath();

    const hedhogFilePath = path.join(
      rootPath,
      'lib',
      'libs',
      toKebabCase(libraryName),
      'hedhog.yaml',
    );

    const libraryPath = path.join(
      rootPath,
      'lib',
      'libs',
      toKebabCase(libraryName),
      'src',
    );

    const tables = this.parseYamlFile(hedhogFilePath);

    for (const table of tables) {
      if (table.name.endsWith('translations')) {
        const baseTableName = pluralize(
          table.name.replace('_translations', ''),
        );

        await this.updateTranslationServiceAndController(
          libraryPath,
          baseTableName,
          table.name,
        );

        await this.applyUpdateToService(libraryPath, baseTableName, table.name);
        continue;
      }

      const fields = table.columns
        .map((column) => {
          const columnName = column.type === 'slug' ? 'slug' : column.name;
          const columnType = column.type === 'slug' ? 'varchar' : column.type;
          if (!columnName) return '';
          const lengthPart = column.length ? `${column.length}` : '255';
          return `${columnName}:${columnType || 'varchar'}:${lengthPart}`;
        })
        .filter(Boolean)
        .join(',');

      await createDTOs(path.join(libraryPath, toKebabCase(table.name)), fields);
      await createService(libraryPath, table.name, table.columns);
      await createModule(libraryPath, table.name, {
        useLibraryNamePath: true,
        importServices: true,
      });
      await createController(libraryPath, table.name);
      await this.updateParentModule(
        path.join(libraryPath, `${toKebabCase(libraryName)}.module.ts`),
        table.name,
      );
    }
  }

  async updateTranslationServiceAndController(
    libraryPath: string,
    baseTableName: string,
    translationTableName: string,
  ) {
    const serviceFilePath = path.join(
      libraryPath,
      toKebabCase(baseTableName),
      `${toKebabCase(baseTableName)}.service.ts`,
    );
    const controllerFilePath = path.join(
      libraryPath,
      toKebabCase(baseTableName),
      `${toKebabCase(baseTableName)}.controller.ts`,
    );

    try {
      let serviceContent = await readFile(serviceFilePath, 'utf-8');

      const getFunctionReplacement = `
      async get(locale: string, paginationParams: PaginationDTO) {
        const OR: any[] = [
          {
            name: { contains: paginationParams.search, mode: 'insensitive' },
          },
          { id: { equals: +paginationParams.search } },
        ];
  
        const include = {
          ${baseTableName}: {
            select: {
              id: true,
              ${translationTableName}: {
                where: {
                  locales: {
                    code: locale,
                  },
                },
                select: {
                  name: true,
                },
              },
            },
          },
        };
  
        return this.paginationService.paginate(
          this.prismaService.${translationTableName},
          paginationParams,
          {
            where: {
              OR,
            },
            include,
          },
          '${translationTableName}'
        );
      }
      `.trim();

      serviceContent = serviceContent.replace(
        /async get\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/gm,
        getFunctionReplacement,
      );

      const regexToRemove = new RegExp(
        `return this\\.paginationService\\.paginate\\(\\s*this\\.prismaService\\.${baseTableName},[\\s\\S]*?\\);\\n\\s*\\}`,
        'm',
      );
      serviceContent = serviceContent.replace(regexToRemove, '');

      await writeFile(serviceFilePath, serviceContent);
      await prettier(serviceFilePath);
    } catch (error) {
      console.error(`Erro ao modificar service: ${error.message}`);
    }

    try {
      let controllerContent = await readFile(controllerFilePath, 'utf-8');
      const localeDecorator = '@Locale() locale';
      if (!controllerContent.includes(localeDecorator)) {
        controllerContent = controllerContent.replace(
          `async get(@Pagination() paginationParams) {`,
          `async get(@Pagination() paginationParams, ${localeDecorator}){`,
        );

        controllerContent = controllerContent.replace(
          `return this.${toCamelCase(baseTableName)}Service.get(paginationParams)`,
          `return this.${toCamelCase(baseTableName)}Service.get(locale, paginationParams)`,
        );
      }

      const importStatement = "import { Locale } from '@hedhog/admin';";
      if (!controllerContent.includes(importStatement)) {
        controllerContent = `${importStatement}\n${controllerContent}`;
      }

      await writeFile(controllerFilePath, controllerContent);
      await prettier(controllerFilePath);
    } catch (error) {
      console.error(`Erro ao modificar controller: ${error.message}`);
    }
  }

  private parseYamlFile(filePath: string) {
    const fileContents = readFileSync(filePath, 'utf8');
    const data = yaml.parse(fileContents);

    const tables: Table[] = Object.keys(data.tables).map((tableName) => ({
      name: tableName,
      columns: data.tables[tableName].columns,
      ifNotExists: data.tables[tableName].ifNotExists,
    }));

    return tables;
  }

  private async updateParentModule(modulePath: string, newModuleName: string) {
    if (!modulePath) {
      console.error(chalk.red(`Parent module file not found.`));
      return;
    }

    newModuleName = toPascalCase(newModuleName);

    try {
      let moduleContent = await readFileSync(modulePath, 'utf8');

      const importStatement = `import { ${newModuleName}Module } from './${newModuleName}/${newModuleName}.module';`;
      if (!moduleContent.includes(importStatement)) {
        moduleContent = `${importStatement}\n\n${moduleContent}`;
      }

      const moduleImportRegex = /imports:\s*\[(.*?)\]/s;
      moduleContent = moduleContent.replace(moduleImportRegex, (match) => {
        return match.replace(']', `,\n    ${newModuleName}Module]`);
      });

      await writeFile(modulePath, moduleContent);
    } catch (error) {
      console.error(
        chalk.red(`Error updating parent module: ${error.message}`),
      );
    }
  }

  private async applyUpdateToService(
    libraryPath: string,
    baseTableName: string,
    translationTableName: string,
  ) {
    const serviceFilePath = path.join(
      libraryPath,
      toKebabCase(baseTableName),
      `${toKebabCase(baseTableName)}.service.ts`,
    );
    let serviceContent = await readFile(serviceFilePath, 'utf-8');

    const includeLogic = `
    include: {
      ${translationTableName}: {
        select: {
          id: true,
          ${translationTableName}: {
            where: {
              locales: {
                code: locale,
              },
            },
            select: {
              name: true,
            },
          },
        },
      },
    },
  `;

    serviceContent = serviceContent.replace(
      'findMany({',
      `findMany({ ${includeLogic}`,
    );
    await writeFile(serviceFilePath, serviceContent);
  }
}
