import chalk = require('chalk');
import { AbstractAction } from '.';
import { Input } from '../commands';
import path = require('path');
import * as yaml from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { DTOCreator } from '../lib/classes/DtoCreator';
import { readFile, mkdir, writeFile, readdir } from 'fs/promises';
import {
  toCamelCase,
  toKebabCase,
  toObjectCase,
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
import { filterScreenCreation } from '../lib/utils/filter-screen-creation';
import { Column } from '../lib/types/column';
import { Table } from '../lib/types/table';
import { TableFactory } from '../lib/classes/TableFactory';
import { HedhogFile } from '../lib/classes/HedHogFile';
import { FileCreator } from '../lib/classes/FileCreator';

export class ApplyAction extends AbstractAction {
  private libraryName = '';
  private rootPath = '';
  private hedhogFilePath = '';
  private libraryPath = '';
  private librarySrcPath = '';
  private libraryFrontEndPath = '';

  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    this.rootPath = await getRootPath();

    this.hedhogFilePath = path.join(
      this.rootPath,
      'lib',
      'libs',
      toKebabCase(this.libraryName),
      'hedhog.yaml',
    );

    this.libraryPath = path.join(
      this.rootPath,
      'lib',
      'libs',
      toKebabCase(this.libraryName),
    );

    if (!this.libraryName.length) {
      console.error(chalk.red('You must tell a name for the module.'));
      process.exit(1);
    }

    if (/\s/.test(this.libraryName)) {
      console.error(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    this.librarySrcPath = path.join(this.libraryPath, 'src');
    this.libraryFrontEndPath = path.join(this.libraryPath, 'frontend');
    const tables = this.parseYamlFile(this.hedhogFilePath);
    const hedhogFile = await new HedhogFile().load(this.hedhogFilePath);

    for (const table of hedhogFile.getTables()) {
      const tableApply = await TableFactory.create(table, this.hedhogFilePath);
      const screenWithRelations = tableApply.findTableWithRelation();
      const dtoFilePath = path.join(
        this.librarySrcPath,
        screenWithRelations ?? '',
        table.name.toKebabCase(),
      );

      const tableNameRelation = tableApply.tableNameRelation;
      const pkName = tableApply.pkName;
      const fkName = tableApply.fkName;
      const hasLocale = tableApply.hasLocale;
      const baseTableName = tableApply.baseName;
      const tablesWithRelations = tableApply.hedhogFile.screensWithRelations;

      if (!screenWithRelations) {
        await this.createTranslationFiles(baseTableName);
      }

      if (table.name.endsWith('_locale')) {
        await this.updateTranslationServiceAndController(
          baseTableName,
          screenWithRelations,
        );
        continue;
      }

      const fields = table.columns
        .filter(
          ({ type }) => !['pk', 'created_at', 'updated_at'].includes(type),
        )
        .map((column) => {
          const columnName = column.type === 'slug' ? 'slug' : column.name;
          const columnType = column.type === 'slug' ? 'varchar' : column.type;
          if (!columnName) return '';
          const lengthPart = column.length ? `${column.length}` : '255';
          return `${columnName}:${columnType || 'varchar'}:${lengthPart}:${Boolean(column.isNullable)}`;
        })
        .filter(Boolean)
        .join(',');

      console.log({
        dtos: fields,
        hasLocale,
        tableName: toObjectCase(table.name),
        tableNameRelation: toObjectCase(tableNameRelation),
        hasRelationsWith: Boolean(screenWithRelations),
        pkName: toObjectCase(pkName),
        fkName: toObjectCase(fkName),
        fields: tableApply
          .getColumns()
          .map((t) => t.name)
          .map((field) => toObjectCase(field)),
      });

      new DTOCreator(dtoFilePath, fields, hasLocale)
        .createDTOs()
        .then(() => console.log('DTOs criados com sucesso!'));

      console.log({ tableApply, hasLocale });

      new FileCreator(this.librarySrcPath, tableApply, 'service', {
        fields: table.columns,
        useLibraryNamePath: true,
        hasRelationsWith: screenWithRelations,
      }).createFile();

      new FileCreator(this.librarySrcPath, tableApply, 'controller', {
        useLibraryNamePath: true,
        hasRelationsWith: screenWithRelations,
      }).createFile();

      new FileCreator(this.librarySrcPath, tableApply, 'module', {
        useLibraryNamePath: true,
        importServices: true,
        hasRelationsWith: screenWithRelations,
        tablesWithRelations,
      }).createFile();

      await createScreen(
        this.libraryFrontEndPath,
        this.libraryName,
        table.name,
        'screen',
        {
          useLibraryNamePath: true,
        },
      );

      addRoutesToYaml(this.librarySrcPath, table.name, screenWithRelations);

      if (!screenWithRelations) {
        await this.updateParentModule(
          path.join(
            this.librarySrcPath,
            `${toKebabCase(this.libraryName)}.module.ts`,
          ),
          table.name,
        );
      }
      await this.createFrontendFiles(
        table.name,
        table.columns,
        tables,
        tablesWithRelations as any[],
      );
    }

    const dependencyTables = await this.checkRelationsTable(tables);

    await addPackageJsonPeerDependencies(this.libraryName, dependencyTables);

    await this.installDependencies(
      this.libraryPath,
      [{ name: '', value: '' }],
      dependencyTables,
    );

    const hedhogFile2 = yaml.parse(
      await readFile(this.hedhogFilePath, 'utf-8'),
    );
    const screensArray = Object.keys(hedhogFile2.screens);

    for (const screen of screensArray) {
      await this.createScreenRouterFile(screen);
    }
  }

  async createScreenRouterFile(screen: string) {
    const YAMLContent = await readFile(this.hedhogFilePath, 'utf-8');
    const yamlData = yaml.parse(YAMLContent);

    if (!yamlData.routes) {
      yamlData.routes = [];
    }

    let moduleRoute = yamlData.routes.find(
      (route: any) => route.path === this.libraryName,
    );

    if (!moduleRoute) {
      moduleRoute = { path: `${this.libraryName}`, children: [] };
      yamlData.routes.push(moduleRoute);
    }

    moduleRoute.children.push({
      path: toKebabCase(screen),
      lazy: {
        component: `./pages/${toKebabCase(this.libraryName)}/${toKebabCase(screen)}/index.tsx`,
      },
    });

    const updatedYAML = yaml.stringify({
      ...yamlData,
      routes: yamlData.routes,
    });
    await writeFile(this.hedhogFilePath, updatedYAML, 'utf-8');
  }

  async screensWithRelations() {
    if (!existsSync(this.hedhogFilePath)) {
      console.error(
        chalk.red(`hedhog.yaml file not found at ${this.hedhogFilePath}`),
      );
      return;
    }

    const hedhogFile = yaml.parse(await readFile(this.hedhogFilePath, 'utf-8'));
    const screens = hedhogFile.screens || {};
    return Object.keys(screens)
      .filter((screen) => screens[screen].relations)
      .map((screen) => ({
        name: screen,
        relations: Object.keys(screens[screen].relations),
      }));
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
    const hedhogLibsPath = path.join(this.rootPath, 'lib', 'libs');
    for (const folder of await readdir(hedhogLibsPath)) {
      const hedhogFilePath = path.join(hedhogLibsPath, folder, 'hedhog.yaml');
      if (existsSync(hedhogFilePath)) {
        const hedhogFile = this.parseYamlFile(hedhogFilePath);
        tables[folder] = hedhogFile;
      }
    }
    return tables;
  }

  async createTranslationFiles(tableName: string) {
    const spinner = ora(`Create translation files...`).start();
    const localesAdminFolder = path.join(
      this.rootPath,
      'admin',
      'src',
      'locales',
    );
    const localesFolder = path.join(
      this.rootPath,
      'lib',
      'libs',
      this.libraryName,
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
          `${this.libraryName}.${toKebabCase(tableName)}.json`,
        );
        const templatePath = path.join(
          __dirname,
          '..',
          'templates',
          'translation.json.ejs',
        );
        let fileContent = render(await readFile(templatePath, 'utf-8'), {
          tableName,
          libraryName: this.libraryName,
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

  mapFieldTypeToInputType(field: Column) {
    if (field.type === 'fk' && field.references?.table === 'file') {
      return `EnumFieldType.FILE`;
    }

    switch (field.type) {
      case 'text':
        return `EnumFieldType.RICHTEXT`;
      case 'varchar':
      case 'slug':
        return `EnumFieldType.TEXT`;
      case 'fk':
        return `EnumFieldType.COMBOBOX`;
      case 'date':
        return `EnumFieldType.DATEPICKER`;
      case 'boolean':
        return `EnumFieldType.SWITCH`;
      default:
        return `EnumFieldType.TEXT`;
    }
  }

  getComboboxProperties(field: Column) {
    if (field.type !== 'fk') return;

    const url = `/${toKebabCase(String(field.references?.table))}`;
    const displayName = field.name.replace('_id', '');
    const valueName = field.name.endsWith('id') ? 'id' : 'name';

    return { url, displayName, valueName };
  }

  async createFrontendFiles(
    tableName: string,
    fields: Column[],
    tables: any,
    tablesWithRelations: any[],
  ) {
    fields = fields
      .filter((field) => field.name || field.type === 'slug')
      .map((f) => {
        if (f.type === 'slug') {
          f.name = 'slug';
        }
        return f;
      })
      .map((field) => ({
        ...field,
        inputType: this.mapFieldTypeToInputType(field),
        ...this.getComboboxProperties(field),
      }));

    const frontendPath = path.join(this.librarySrcPath, '..', 'frontend');
    const hasLocale = hasLocaleYaml(this.librarySrcPath, tableName);
    const extraTabs: any[] = [];
    const extraVars: any[] = [];
    const extraImports: any[] = [];
    const relatedItems = tablesWithRelations.flatMap((item) => item.name);
    const relationOfItems = tablesWithRelations
      .filter((i) => i.name.includes(relatedItems))
      .flatMap((i) => i.relations);

    if (relatedItems.includes(tableName)) {
      const templateContent = await readFile(
        path.join(__dirname, '..', 'templates', 'tab-panel-item.ts.ejs'),
        'utf-8',
      );

      const relationTables = ((await this.screensWithRelations()) ?? [])
        .map((item: any) => item.relations)
        .flat();

      for (const tableName of relationTables) {
        const variableRendering = render(
          await readFile(
            path.join(__dirname, '..', 'templates', 'tab-panel-ref.ts.ejs'),
            'utf-8',
          ),
          { tableName },
        );

        const importsRendering = render(
          await readFile(
            path.join(__dirname, '..', 'templates', 'tab-panel-imports.ts.ejs'),
            'utf-8',
          ),
          { tableName },
        );

        extraVars.push(variableRendering);
        extraImports.push(importsRendering);
      }

      for (const relatedTable of relationOfItems) {
        const table: Table = tables.find(
          (t: Column) => t.name === relatedTable,
        );

        const mainField = table.columns.find((f) => f.name === 'name') ||
          table.columns.find((f) => f.name === 'title') ||
          table.columns.find((f) => f.type === 'slug') ||
          table.columns.find((f) => f.type === 'varchar') || {
            name: 'id',
            ...table.columns.find((f) => f.type === 'pk'),
          };

        const renderedContent = render(templateContent, {
          mainField: mainField?.name,
          tableName: relatedTable,
        });
        extraTabs.push(renderedContent);
      }
    }

    const tasks = [
      {
        subPath: 'react-query',
        templates: [
          'requests.ts.ejs',
          'requests-related.ts.ejs',
          'handlers.ts.ejs',
        ],
        data: { tableName, hasLocale, libraryName: this.libraryName, fields },
      },
      {
        subPath: 'components',
        templates: ['create-panel.ts.ejs', 'update-panel.ts.ejs'],
        data: {
          tableName,
          hasLocale,
          libraryName: this.libraryName,
          fields,
          extraTabs,
          extraVars,
          extraImports: extraImports.join('\n'),
        },
      },
    ];

    for (const task of tasks) {
      if (!(await filterScreenCreation(this.librarySrcPath, tableName, task))) {
        continue;
      }

      const taskPath = path.join(
        frontendPath,
        toKebabCase(tableName),
        task.subPath,
      );

      await mkdir(taskPath, { recursive: true });

      for (const template of task.templates) {
        const hasRelations = tablesWithRelations.find((t) =>
          t.relations.includes(tableName),
        );

        if (
          (hasRelations && template === 'requests-related.ts.ejs') ||
          (!hasRelations && template === 'requests.ts.ejs') ||
          !template.includes('requests')
        ) {
          const templatePath = path.join(
            __dirname,
            '..',
            'templates',
            template,
          );
          const fileContent = render(
            await readFile(templatePath, 'utf-8'),
            task.data,
          );
          const formattedContent = await formatTypeScriptCode(fileContent);
          const outputFilePath = path.join(
            taskPath,
            template
              .replace('-related', '')
              .replace(
                '.ts.ejs',
                task.subPath === 'components' ? '.tsx.ejs' : '.ts.ejs',
              ),
          );
          await writeFile(outputFilePath, formattedContent);
        }
      }
    }
  }

  async updateTranslationServiceAndController(
    baseTableName: string,
    hasRelationsWith: string,
  ) {
    const controllerFilePath = path.join(
      this.librarySrcPath,
      hasRelationsWith ?? '',
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
