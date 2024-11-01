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
      const baseTableName = table.name.replace('_locale', '');

      if (table.name.endsWith('locale')) {
        await this.updateTranslationServiceAndController(
          libraryPath,
          baseTableName,
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
      await createFile(
        libraryPath,
        table.name,
        'service',
        {
          fields: table.columns,
          useLibraryNamePath: true,
        },
        hasLocaleYaml(libraryPath, baseTableName),
      );

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
      await this.createFrontendFiles(libraryPath, table.name, table.columns);
    }
  }

  async createFrontendFiles(
    libraryPath: string,
    tableName: string,
    fields: Column[],
  ) {
    const frontendPath = path.join(libraryPath, '..', 'frontend');
    const hasLocale = await hasLocaleYaml(libraryPath, tableName);

    const tasks = [
      {
        subPath: 'react-query',
        templates: ['requests.ts.ejs', 'handlers.ts.ejs'],
        data: { tableName, hasLocale },
      },
      {
        subPath: 'components',
        templates: ['create-panel.ts.ejs', 'update-panel.ts.ejs'],
        data: { tableName, hasLocale, fields },
      },
    ];

    for (const task of tasks) {
      const taskPath = path.join(
        frontendPath,
        toKebabCase(tableName),
        task.subPath,
      );
      await mkdir(taskPath, { recursive: true });

      for (const template of task.templates) {
        const templatePath = path.join(__dirname, '..', 'templates', template);
        const fileContent = render(
          await readFile(templatePath, 'utf-8'),
          task.data,
        );
        const formattedContent = await formatTypeScriptCode(fileContent);
        const outputFilePath = path.join(
          taskPath,
          template.replace(
            '.ts.ejs',
            task.subPath === 'components' ? '.tsx' : '.ts',
          ),
        );
        await writeFile(outputFilePath, formattedContent);
      }
    }
  }

  async updateTranslationServiceAndController(
    libraryPath: string,
    baseTableName: string,
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
