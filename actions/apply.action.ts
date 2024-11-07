import chalk = require('chalk');
import { AbstractAction } from '.';
import { Input } from '../commands';
import path = require('path');
import * as yaml from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { createDTOs } from '../lib/utils/create-dto';
import { readFile, mkdir, writeFile, readdir } from 'fs/promises';
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
import { formatWithPrettier } from '../lib/utils/format-with-prettier';
import { EMOJIS } from '../lib/ui';
import { createScreen } from '../lib/utils/create-screen';
import { getConfig } from '../lib/utils/get-config';
import OpenAI from 'openai';
import * as ora from 'ora';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { addPackageJsonPeerDependencies } from '../lib/utils/update-files';

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
  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

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
    );

    const librarySrcPath = path.join(libraryPath, 'src');
    const libraryFrontEndPath = path.join(libraryPath, 'frontend');

    const tables = this.parseYamlFile(hedhogFilePath);

    for (const table of tables) {
      const baseTableName = table.name.replace('_locale', '');

      await this.createTranslationFiles(baseTableName, libraryName);

      if (table.name.endsWith('_locale')) {
        await this.updateTranslationServiceAndController(
          librarySrcPath,
          baseTableName,
        );
        continue;
      }

      const hasLocale = hasLocaleYaml(librarySrcPath, baseTableName);
      const fields = table.columns
        .filter((column) => column.type !== 'pk')
        .map((column) => {
          const columnName = column.type === 'slug' ? 'slug' : column.name;
          const columnType = column.type === 'slug' ? 'varchar' : column.type;
          if (!columnName) return '';
          const lengthPart = column.length ? `${column.length}` : '255';
          return `${columnName}:${columnType || 'varchar'}:${lengthPart}`;
        })
        .filter(Boolean)
        .join(',');

      await createDTOs(
        path.join(librarySrcPath, toKebabCase(table.name)),
        fields,
        hasLocale,
      );

      const dependencyTables = await this.checkRelationsTable(tables);
      await this.installDependencies(
        libraryPath,
        [{ name: '', value: '' }],
        dependencyTables,
      );
      await addPackageJsonPeerDependencies(libraryName, dependencyTables);

      await createFile(
        librarySrcPath,
        table.name,
        'service',
        {
          fields: table.columns,
          useLibraryNamePath: true,
        },
        hasLocale,
      );

      await createFile(librarySrcPath, table.name, 'module', {
        useLibraryNamePath: true,
        importServices: true,
      });

      await createFile(librarySrcPath, table.name, 'controller', {
        useLibraryNamePath: true,
      });

      await createScreen(libraryFrontEndPath, table.name, 'screen', {
        useLibraryNamePath: true,
      });

      await addRoutesToYaml(librarySrcPath, table.name);
      await this.updateParentModule(
        path.join(librarySrcPath, `${toKebabCase(libraryName)}.module.ts`),
        table.name,
      );
      await this.createFrontendFiles(librarySrcPath, table.name, table.columns);
    }
  }

  async getOpenIAToken() {
    return await getConfig('tokens.OPENIA');
  }

  async checkRelationsTable(tables: any[]) {
    const relationTables = tables
      .flatMap((table) => table.columns)
      .filter((column) => column.type === 'fk')
      .map((column) => column.references.table)
      .filter((table) => !tables.map((table) => table.name).includes(table));

    const tablesFromLibs = await this.getTablesFromLibs();
    const dependencyModuleNames = new Set<string>();

    for (const relationTable of relationTables) {
      for (const libTables of Object.keys(tablesFromLibs)) {
        if (
          tablesFromLibs[libTables]
            .map((table: any) => table.name)
            .includes(relationTable)
        ) {
          dependencyModuleNames.add(`@hedhog/${libTables}`);
        }
      }
    }

    return Array.from(dependencyModuleNames);
  }

  async getTablesFromLibs() {
    const tables = {} as any;
    const rootPath = await getRootPath();
    const hedhogLibsPath = path.join(rootPath, 'lib', 'libs');
    for (const folder of await readdir(hedhogLibsPath)) {
      const hedhogFilePath = path.join(hedhogLibsPath, folder, 'hedhog.yaml');
      if (existsSync(hedhogFilePath)) {
        const hedhogFile = this.parseYamlFile(hedhogFilePath);
        tables[folder] = hedhogFile;
      }
    }
    return tables;
  }

  async createTranslationFiles(tableName: string, libraryName: string) {
    const spinner = ora(`Create translation files...`).start();

    const rootPath = await getRootPath();
    const localesAdminFolder = path.join(rootPath, 'admin', 'src', 'locales');
    const localesFolder = path.join(
      rootPath,
      'lib',
      'libs',
      libraryName,
      'frontend',
    );
    const folders = await readdir(localesAdminFolder, { withFileTypes: true });

    for (const folder of folders) {
      if (folder.isDirectory()) {
        spinner.info(`Creating translation file for ${folder.name}...`);

        const folderPath = path.join(
          localesFolder,
          toKebabCase(tableName),
          'locales',
          folder.name,
        );

        await mkdirRecursive(folderPath);

        const filePath = path.join(
          folderPath,
          `${libraryName}.${toKebabCase(tableName)}.json`,
        );
        const templatePath = path.join(
          __dirname,
          '..',
          'templates',
          'translation.json.ejs',
        );
        let fileContent = render(await readFile(templatePath, 'utf-8'), {
          tableName,
          libraryName,
        });

        const token = await this.getOpenIAToken();

        if (token) {
          spinner.info(`Requesting translation for ${folder.name} with IA...`);

          const assistentId = await getConfig('assistents.applyLocale');
          const response = await this.messageToOpenIaAssistent(
            assistentId,
            `Idioma: ${folder.name} Coisa: ${tableName.replaceAll('_', ' ')}`,
          );
          if (response) {
            fileContent = response;
          }
        }

        await writeFile(
          filePath,
          await formatWithPrettier(fileContent, {
            parser: 'json',
            singleQuote: true,
            trailingComma: 'all',
          }),
          'utf-8',
        );

        spinner.succeed(`Translation file for ${folder.name} created.`);
      }
    }
  }

  async messageToOpenIaAssistent(assistantId: string, content: string) {
    const hash = createHash('sha256').update(content).digest('hex');
    const cacheDirPath = path.join(
      homedir(),
      '.hedhog',
      'cache',
      `assistant-${assistantId}`,
    );
    const cacheFilePath = path.join(cacheDirPath, hash);

    if (existsSync(cacheFilePath)) {
      return await readFile(cacheFilePath, 'utf-8');
    }

    const apiKey = await this.getOpenIAToken();
    const client = new OpenAI({
      apiKey,
    });

    try {
      const thread = await client.beta.threads.create({
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      });

      const threadId = thread.id;

      let response = '';

      const run = client.beta.threads.runs
        .stream(threadId, {
          assistant_id: assistantId,
        })
        .on('textDelta', (_delta, snapshot) => {
          response = snapshot.value;
        });
      await run.finalRun();

      await mkdirRecursive(cacheDirPath);
      await writeFile(cacheFilePath, response, 'utf-8');

      return response;
    } catch (e) {
      console.error(chalk.red(`Error sending message to OpenAI: ${e.message}`));
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
            task.subPath === 'components' ? '.tsx.ejs' : '.ts.ejs',
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

      const importStatement = "import { Locale } from '@hedhog/locale';";
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

      moduleContent = await formatWithPrettier(moduleContent, {
        parser: 'typescript',
        printWidth: 100000,
        singleQuote: true,
        trailingComma: 'all',
        semi: true,
      });

      const importStatement = this.createImportStatement(newModuleName);
      if (moduleContent.includes(importStatement)) {
        return false;
      }
      moduleContent = `${importStatement}\n${moduleContent}`;

      const { startImportsIndex, endImportsIndex, importsMatch } =
        this.extractImportsSection(moduleContent);

      if (!importsMatch) {
        console.error(
          chalk.red(
            `${EMOJIS.ERROR} "imports" property not found in @Module decorator.`,
          ),
        );
        return;
      }

      const importsList = this.parseImportsList(importsMatch);
      importsList.push(
        `forwardRef(() => ${toPascalCase(newModuleName)}Module)`,
      );

      const startFileContent = moduleContent.substring(0, startImportsIndex);
      const endFileContent = moduleContent.substring(endImportsIndex - 1);

      const formattedContent = await formatWithPrettier(
        `${startFileContent}${importsList.join(', ')}${endFileContent}`,
        {
          parser: 'typescript',
          singleQuote: true,
          trailingComma: 'all',
          semi: true,
        },
      );
      await writeFile(modulePath, formattedContent, 'utf8');
    } catch (error) {
      console.error(
        chalk.red(`Error updating parent module: ${error.message}`),
      );
    }
  }

  private createImportStatement(newModuleName: string): string {
    return `import { ${toPascalCase(newModuleName)}Module } from './${toKebabCase(newModuleName)}/${toKebabCase(newModuleName)}.module';`;
  }

  private extractImportsSection(moduleContent: string) {
    const importFind = 'imports: [';
    const startImportsIndex =
      moduleContent.indexOf(importFind) + importFind.length;
    let endImportsIndex = 0;
    let openBracketCount = 1;
    let importsMatch = '';

    for (let i = startImportsIndex; i < moduleContent.length; i++) {
      if (moduleContent[i] === '[') {
        openBracketCount++;
      }

      if (moduleContent[i] === ']') {
        openBracketCount--;
      }

      if (openBracketCount === 0) {
        endImportsIndex = i + 1;
        importsMatch = moduleContent.substring(startImportsIndex, i);
        break;
      }
    }

    return { startImportsIndex, endImportsIndex, importsMatch };
  }

  private parseImportsList(importsMatch: string): string[] {
    const importsList: string[] = [];
    let openBracketCount = 0;
    let openBracesCount = 0;

    for (let i = 0; i < importsMatch.length; i++) {
      if (importsMatch[i] === '[') {
        openBracketCount++;
      }

      if (importsMatch[i] === ']') {
        openBracketCount--;
      }

      if (importsMatch[i] === '{') {
        openBracesCount++;
      }

      if (importsMatch[i] === '}') {
        openBracesCount--;
      }

      if (openBracketCount === 0 && openBracesCount === 0) {
        if (importsMatch[i] === ',') {
          if (importsMatch.substring(0, i).trim()) {
            importsList.push(importsMatch.substring(0, i).trim());
          }
          importsMatch = importsMatch.substring(i + 1);
          i = 0;
        }
      }
    }

    if (importsMatch.trim()) {
      importsList.push(importsMatch.trim());
    }

    return importsList;
  }
}
