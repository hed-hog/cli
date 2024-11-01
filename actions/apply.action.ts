import chalk = require('chalk');
import { AbstractAction } from '.';
import { Input } from '../commands';
import path = require('path');
import * as yaml from 'yaml';
import { readFileSync } from 'fs';
import { createDTOs } from '../lib/utils/create-dto';
import { readFile, mkdir, writeFile } from 'fs/promises';
import {
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from '../lib/utils/convert-string-cases';
import { getRootPath } from '../lib/utils/get-root-path';
import { addRoutesToYaml } from '../lib/utils/add-routes-yaml';
import { render } from 'ejs';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import hasLocaleYaml from '../lib/utils/has-locale-yaml';
import { createFile } from '../lib/utils/create-file';

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
      if (table.name.endsWith('locale')) {
        const baseTableName = table.name.replace('_locale', '');

        await this.updateTranslationServiceAndController(
          libraryPath,
          baseTableName,
          table.name,
        );

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
      await createFile(libraryPath, table.name, 'service', {
        fields: table.columns,
        useLibraryNamePath: true,
      });
      console.log('create', table.name);
      await createFile(libraryPath, table.name, 'module', {
        useLibraryNamePath: true,
        importServices: true,
      });
      await createFile(libraryPath, table.name, 'controller', {
        useLibraryNamePath: true,
      });
      await addRoutesToYaml(libraryPath, table.name);
      await this.updateParentModule(
        path.join(libraryPath, `${toKebabCase(libraryName)}.module.ts`),
        table.name,
      );
      await this.createFrontendFiles(libraryPath, table.name);
    }
  }

  async createFrontendFiles(libraryPath: string, tableName: string) {
    await this.createRequestsFiles(libraryPath, tableName);
    await this.createComponentFiles(libraryPath, tableName);
  }

  async createRequestsFiles(libraryPath: string, tableName: string) {
    const frontendPath = path.join(libraryPath, '..', 'frontend');
    const tableRequestsPath = path.join(
      frontendPath,
      toKebabCase(tableName),
      'react-query',
    );
    await mkdir(tableRequestsPath, { recursive: true });
    const templates = ['requests.ts.ejs', 'handlers.ts.ejs'];
    const hasLocale = await hasLocaleYaml(libraryPath, tableName);

    for (const template of templates) {
      const templatePath = path.join(__dirname, '..', 'templates', template);
      const fileContent = render(await readFile(templatePath, 'utf-8'), {
        tableName,
        hasLocale,
      });
      const formattedContent = await formatTypeScriptCode(fileContent);
      const outputFilePath = path.join(
        tableRequestsPath,
        template.replace('.ejs', ''),
      );
      await writeFile(outputFilePath, formattedContent);
    }
  }

  async createComponentFiles(libraryPath: string, tableName: string) {
    const frontendPath = path.join(libraryPath, '..', 'frontend');
    const tableComponentsPath = path.join(
      frontendPath,
      toKebabCase(tableName),
      'components',
    );
    await mkdir(tableComponentsPath, { recursive: true });
    const templates = ['create-panel.ts.ejs', 'update-panel.ts.ejs'];
    const hasLocale = await hasLocaleYaml(libraryPath, tableName);

    for (const template of templates) {
      const templatePath = path.join(__dirname, '..', 'templates', template);
      const fileContent = render(await readFile(templatePath, 'utf-8'), {
        tableName,
        hasLocale,
      });
      const formattedContent = await formatTypeScriptCode(fileContent);
      const outputFilePath = path.join(
        tableComponentsPath,
        template.replace('.ejs', ''),
      );
      await writeFile(outputFilePath, formattedContent);
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
      async list(locale: string, paginationParams: PaginationDTO) {
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
                  locale: {
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
      }`.trim();

      serviceContent = serviceContent.replace(
        /async list\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/gm,
        getFunctionReplacement,
      );

      const regexToRemove = new RegExp(
        `return this\\.paginationService\\.paginate\\(\\s*this\\.prismaService\\.${baseTableName},[\\s\\S]*?\\);\\n\\s*\\}`,
        'm',
      );
      serviceContent = serviceContent.replace(regexToRemove, '');

      const formattedContent = await formatTypeScriptCode(serviceContent);
      await writeFile(serviceFilePath, formattedContent);
    } catch (error) {
      console.error(`Erro ao modificar service: ${error.message}`);
    }

    try {
      let controllerContent = await readFile(controllerFilePath, 'utf-8');
      const localeDecorator = '@Locale() locale';
      if (!controllerContent.includes(localeDecorator)) {
        controllerContent = controllerContent.replace(
          `async list(@Pagination() paginationParams) {`,
          `async list(@Pagination() paginationParams, ${localeDecorator}){`,
        );

        controllerContent = controllerContent.replace(
          `return this.${toCamelCase(baseTableName)}Service.list(paginationParams)`,
          `return this.${toCamelCase(baseTableName)}Service.list(locale, paginationParams)`,
        );
      }

      const importStatement = "import { Locale } from '@hedhog/admin';";
      if (!controllerContent.includes(importStatement)) {
        controllerContent = `${importStatement}\n${controllerContent}`;
      }

      const formattedContent = await formatTypeScriptCode(controllerContent);
      await writeFile(controllerFilePath, formattedContent);
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

      const importStatement = `import { ${toPascalCase(newModuleName)}Module } from './${toKebabCase(newModuleName)}/${toKebabCase(newModuleName)}.module';`;
      if (!moduleContent.includes(importStatement)) {
        moduleContent = `${importStatement}\n${moduleContent}`;
      }

      const moduleImportRegex = /imports:\s*\[(.*?)\]/s;
      moduleContent = moduleContent.replace(moduleImportRegex, (match) => {
        return match.replace(
          ']',
          `,\n    ${toPascalCase(newModuleName)}Module]`,
        );
      });

      const formattedContent = await formatTypeScriptCode(moduleContent);
      await writeFile(modulePath, formattedContent);
    } catch (error) {
      console.error(
        chalk.red(`Error updating parent module: ${error.message}`),
      );
    }
  }
}
