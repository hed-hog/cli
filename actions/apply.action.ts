import chalk = require('chalk');
import { render } from 'ejs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import * as ora from 'ora';
import * as yaml from 'yaml';
import { AbstractAction } from '.';
import { Input } from '../commands';
import { DTOCreator } from '../lib/classes/DtoCreator';
import { FileCreator } from '../lib/classes/FileCreator';
import { HedhogFile } from '../lib/classes/HedHogFile';
import { TableFactory } from '../lib/classes/TableFactory';
import TemplateProcessor from '../lib/classes/TemplateProcessor';
import { Column } from '../lib/types/column';
import { HedhogTable } from '../lib/types/hedhog-file';
import { Table } from '../lib/types/table';
import { EMOJIS } from '../lib/ui';
import { addRoutesToYaml } from '../lib/utils/add-routes-yaml';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import { toObjectCase } from '../lib/utils/convert-string-cases';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';
import { getConfig } from '../lib/utils/get-config';
import { getRootPath } from '../lib/utils/get-root-path';
import { loadHedhogFile } from '../lib/utils/load-hedhog-file';
import { addPackageJsonPeerDependencies } from '../lib/utils/update-files';

export class ApplyAction extends AbstractAction {
  private libraryName = '';
  private rootPath = '';
  private hedhogFilePath = '';
  private libraryPath = '';
  private librarySrcPath = '';
  private hedhogFile: HedhogFile = new HedhogFile();

  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    this.rootPath = await getRootPath();

    this.hedhogFilePath = join(
      this.rootPath,
      'lib',
      'libs',
      this.libraryName.toKebabCase(),
      'hedhog.yaml',
    );

    this.libraryPath = join(
      this.rootPath,
      'lib',
      'libs',
      this.libraryName.toKebabCase(),
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

    this.librarySrcPath = join(this.libraryPath, 'src');
    this.showDebug(`Library name: ${this.libraryName} (${this.libraryPath})`);
    const tables = await this.parseYamlFile(this.hedhogFilePath);
    this.hedhogFile = await new HedhogFile().load(this.hedhogFilePath);

    const localeTables: any[] = [];
    for (const table of this.hedhogFile.getTables()) {
      if (table.name.endsWith('_locale')) {
        localeTables.push(table);
      }
    }

    for (const table of this.hedhogFile.getTables()) {
      const tableApply = await TableFactory.create(table, this.hedhogFilePath);
      const screenWithRelations = tableApply.findTableWithRelation();

      const dtoFilePath = join(
        this.librarySrcPath,
        screenWithRelations ? screenWithRelations.toKebabCase() : '',
        table.name.toKebabCase(),
      );

      const hasLocale = tableApply.hasLocale;
      const baseTableName = tableApply.baseName;
      const tablesWithRelations = tableApply.hedhogFile.screensWithRelations;
      await this.createTranslationFiles(baseTableName);

      if (table.name.endsWith('_locale')) {
        localeTables.push(table);
        continue;
      }

      const fields = table.columns
        .filter(
          ({ type }) => !['pk', 'created_at', 'updated_at'].includes(type),
        )
        .filter((field) => field.name !== tableApply.fkName);

      await new DTOCreator(dtoFilePath, fields, hasLocale).createDTOs();

      console.log('DTOs criados com sucesso!');

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'service',
        {
          useLibraryNamePath: true,
          hasRelationsWith: screenWithRelations,
        },
      ).createFile();

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'controller',
        {
          useLibraryNamePath: true,
          hasRelationsWith: screenWithRelations,
        },
      ).createFile();

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'module',
        {
          useLibraryNamePath: true,
          importServices: true,
          hasRelationsWith: screenWithRelations,
          tablesWithRelations,
        },
      ).createFile();

      await this.generateTranslations(
        this.hedhogFile.screens,
        join(this.libraryPath, 'frontend', 'translation', 'modules'),
        (key, value, en, pt) => {
          en[key] = value.title.en;
          pt[key] = value.title.pt;

          if (value.relations) {
            Object.entries(value.relations).forEach(
              ([relationKey, relationValue]) => {
                en[relationKey] = (relationValue as any).title.en;
                pt[relationKey] = (relationValue as any).title.pt;
              },
            );
          }
        },
      );

      await this.generateTranslations(
        this.hedhogFile.tables,
        join(this.libraryPath, 'frontend', 'translation', 'fields'),
        (tableName, table, en, pt) => {
          const localeTable = localeTables?.find(
            (locale) => locale.name === `${tableName}_locale`,
          );

          if (localeTable) {
            table.columns = table.columns.concat(localeTable.columns);
          }

          table.columns.forEach((column: Column) => {
            if (column.locale) {
              const key = `${tableName}.${column.name ?? column.type}`;
              en[key] = column.locale.en;
              pt[key] = column.locale.pt;
            }
          });
        },
      );

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'screen',
        {
          localeTables,
        },
      ).createFile();

      await addRoutesToYaml(
        this.librarySrcPath,
        table.name,
        screenWithRelations,
      );

      console.log('Arquivos de rotas criados com sucesso!');

      if (!screenWithRelations) {
        console.log('Updating parent module...');
        await this.updateParentModule(
          this.libraryName,
          join(
            this.librarySrcPath,
            `${this.libraryName.toKebabCase()}.module.ts`,
          ),
          table.name,
        );
        console.log('Parent module updated successfully!');
      }

      console.log('Criando arquivos de frontend...');

      await this.createFrontendFiles(
        table.name,
        table.columns,
        tables,
        tablesWithRelations as any[],
      );

      console.log('Arquivos de frontend criados com sucesso!');
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

    if (hedhogFile2.screens) {
      const screensArray = Object.keys(hedhogFile2.screens);
      const YAMLContent = await readFile(this.hedhogFilePath, 'utf-8');
      const yamlData = yaml.parse(YAMLContent);

      yamlData.routes = [];

      const updatedYAML = yaml.stringify({
        ...yamlData,
        routes: yamlData.routes,
      });
      await writeFile(this.hedhogFilePath, updatedYAML, 'utf-8');

      for (const screen of screensArray) {
        await this.createScreenRouterFile(screen);
      }
    }

    //table-enum.ejs

    console.log('============================================');
    if (hedhogFile2.enums) {
      const enumsArray = Object.keys(hedhogFile2.enums);
      for (const enumName of enumsArray) {
        console.log('Criando enum...', enumName);
        await this.createEnumFile(
          this.libraryPath,
          enumName,
          hedhogFile2.enums[enumName].key,
          hedhogFile2.enums[enumName].value,
          hedhogFile2.data[enumName.toSnakeCase()],
        );
      }
    }
    console.log('============================================');
  }

  async createEnumFile(
    path: string,
    enumName: string,
    enumKey: string,
    enumValue: string,
    items: any[],
  ) {
    if (!items || !(items instanceof Array)) return;
    const templatePath = join(
      __dirname,
      '..',
      'templates',
      'enum',
      'table-enum.ejs',
    );

    const destinationPath = join(
      path,
      'src',
      enumName.toKebabCase(),
      `${enumName.toKebabCase()}.enum.ts`,
    );

    const values = [];

    let index = 0;
    for (const item of items) {
      values.push({
        key: item[enumKey].toSnakeCase().toUpperCase(),
        value: item[enumValue] ?? ++index,
      });
    }

    let fileContent = render(await readFile(templatePath, 'utf-8'), {
      enumName: enumName.toPascalCase(),
      values,
    });

    fileContent = await formatWithPrettier(fileContent, {
      parser: 'typescript',
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
      endOfLine: 'lf',
    });

    await writeFile(
      destinationPath,
      await formatTypeScriptCode(fileContent),
      'utf-8',
    );

    await this.addExportInIndexFile(path, destinationPath);
  }

  async addExportInIndexFile(path: string, destinationPath: string) {
    const indexFilePath = join(path, 'src', 'index.ts');
    const fileContent = await readFile(indexFilePath, 'utf-8');

    const exportStatement = `export * from './${destinationPath.replaceAll('\\', '/').replace(path.replaceAll('\\', '/'), '').replace('/src/', '').replace('.ts', '')}';`;

    if (!fileContent.includes(exportStatement)) {
      await writeFile(
        indexFilePath,
        await formatTypeScriptCode(`${fileContent}\n${exportStatement}`),
        'utf-8',
      );
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
      path: screen.toKebabCase(),
      lazy: {
        component: `./pages/${this.libraryName.toKebabCase()}/${screen.toKebabCase()}/index.tsx`,
      },
    });

    const updatedYAML = yaml.stringify({
      ...yamlData,
      routes: yamlData.routes,
    });
    await writeFile(this.hedhogFilePath, updatedYAML, 'utf-8');
  }

  async generateTranslations(
    data: Record<string, any>,
    basePath: string,
    transformFn: (
      key: string,
      value: any,
      en: Record<string, string>,
      pt: Record<string, string>,
    ) => void,
  ) {
    const enTranslations: Record<string, string> = {};
    const ptTranslations: Record<string, string> = {};

    Object.entries(data).forEach(([key, value]) => {
      transformFn(key, value, enTranslations, ptTranslations);
    });

    const enContent = JSON.stringify(enTranslations, null, 2);
    const ptContent = JSON.stringify(ptTranslations, null, 2);

    mkdirSync(basePath, { recursive: true });
    writeFileSync(join(basePath, 'en.json'), enContent, 'utf8');
    writeFileSync(join(basePath, 'pt.json'), ptContent, 'utf8');

    console.log(`Translations generated successfully at: ${basePath}`);
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
    this.showDebug('Getting tables from libs...');
    const tables = {} as any;
    const hedhogLibsPath = join(this.rootPath, 'lib', 'libs');

    for (const folder of await readdir(hedhogLibsPath)) {
      const hedhogFilePath = join(hedhogLibsPath, folder, 'hedhog.yaml');
      if (existsSync(hedhogFilePath)) {
        const hedhogFile = await this.parseYamlFile(hedhogFilePath);
        tables[folder] = hedhogFile;
      }
    }
    return tables;
  }

  async createTranslationFiles(tableName: string) {
    const spinner = ora(`Create translation files...`).start();
    const localesAdminFolder = join(this.rootPath, 'admin', 'src', 'locales');
    const localesFolder = join(
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

        const folderPath = join(
          localesFolder,
          tableName.toKebabCase(),
          'locales',
          folder.name,
        );

        await mkdirRecursive(folderPath);

        const filePath = join(
          folderPath,
          `${this.libraryName}.${tableName.toKebabCase()}.json`,
        );
        const templatePath = join(
          __dirname,
          '..',
          'templates',
          'translation',
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
    const cacheDirPath = join(
      homedir(),
      '.hedhog',
      'cache',
      `assistant-${assistantId}`,
    );
    const cacheFilePath = join(cacheDirPath, hash);

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
    if (field.field) return `EnumFieldType.${field.field.toUpperCase()}`;
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

    const url = `/${String(field.references?.table).toKebabCase()}`;
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
    const table = this.hedhogFile
      .getTables()
      .find((t) => t.name === tableName) as Table;
    const tableApply = await TableFactory.create(table, this.hedhogFilePath);
    fields = fields
      .filter(
        (field) => !['pk', 'created_at', 'updated_at'].includes(field.type),
      )
      .filter((field) => field.locale)
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

    const frontendPath = join(this.librarySrcPath, '..', 'frontend');
    const extraTabs: any[] = [];
    const extraVariables: any[] = [];
    const extraImportStatements: any[] = [];
    const relatedItems = tablesWithRelations.flatMap((item) => item.name);
    const relationOfItems = tablesWithRelations
      .filter((i) => i.name.includes(relatedItems))
      .flatMap((i) => i.relations);

    if (relatedItems.includes(tableName)) {
      const templateContent = await readFile(
        join(__dirname, '..', 'templates', 'panel', 'tab-panel-item.ts.ejs'),
        'utf-8',
      );

      const relationTables = ((await this.screensWithRelations()) ?? [])
        .map((item: any) => item.relations)
        .flat();

      const processor = new TemplateProcessor(relationTables, this.libraryName);
      const { extraVars, extraImports } = await processor.processAllTables();
      extraVariables.push(...extraVars);
      extraImportStatements.push(...extraImports);

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

        const vars: any = {
          tableNameCase: tableApply.name,
          tableNameRelatedCase: relatedTable,
          fkNameCase: tableApply.fkName,
          pkNameCase: tableApply.pkName,
          hasLocale: tableApply.hasLocale,
          mainField: mainField?.name,
          tableName: relatedTable,
        };
        for (const field in vars) {
          if (typeof vars[field] === 'string' && field.endsWith('Case')) {
            vars[field] = toObjectCase(vars[field]);
          }
        }

        const renderedContent = render(templateContent, vars);
        extraTabs.push(renderedContent);
      }
    }

    const hasRelations = tablesWithRelations.find((t) =>
      t.relations.includes(tableName),
    );

    const tasks = [
      {
        subPath: 'react-query',
        templateSubPath: 'async',
        templates: [
          'requests.ts.ejs',
          'requests-related.ts.ejs',
          'handlers.ts.ejs',
          'handlers-related.ts.ejs',
        ],
        data: {
          tableName,
          tableNameCase: toObjectCase(tableApply.name),
          tableNameRelatedCase: toObjectCase(tableApply.tableNameRelation),
          fkNameCase: toObjectCase(tableApply.fkName),
          pkNameCase: toObjectCase(tableApply.pkName),
          hasLocale: tableApply.hasLocale,
          libraryName: this.libraryName,
          fields,
          hasRelations,
        },
      },
      {
        subPath: 'components',
        templateSubPath: 'panel',
        templates: ['create-panel.ts.ejs', 'update-panel.ts.ejs'],
        data: {
          tableName,
          relationTables: tablesWithRelations.filter(
            (t) => t.name === tableApply.name,
          ).length
            ? relationOfItems.map((i) => toObjectCase(i)).map((i) => i.kebab)
            : [],
          tableNameCase: toObjectCase(tableApply.name),
          tableNameRelatedCase: toObjectCase(tableApply.tableNameRelation),
          fkNameCase: toObjectCase(tableApply.fkName),
          pkNameCase: toObjectCase(tableApply.pkName),
          hasLocale: tableApply.hasLocale,
          libraryName: this.libraryName,
          fields,
          hasRelations,
          extraTabs,
          extraVars: extraVariables.join('\n'),
          extraImports: extraImportStatements.join('\n'),
        },
      },
    ];

    for (const task of tasks) {
      const taskPath = join(
        frontendPath,
        tableName.toKebabCase(),
        task.subPath,
      );

      await mkdir(taskPath, { recursive: true });

      for (const template of task.templates) {
        const isRelatedTemplate = template.endsWith('-related.ts.ejs');
        if ((isRelatedTemplate && hasRelations) || !isRelatedTemplate) {
          const templatePath = join(
            __dirname,
            '..',
            'templates',
            task.templateSubPath,
            template,
          );

          const fileContent = render(
            await readFile(templatePath, 'utf-8'),
            task.data,
          );

          const formattedContent = await formatTypeScriptCode(fileContent);
          const outputFilePath = join(
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

  private async parseYamlFile(filePath: string) {
    console.log('parseYamlFile', filePath);

    if (!existsSync(filePath)) {
      console.warn(chalk.yellow(`File not found: ${filePath}`));
      return [];
    }

    const data = await loadHedhogFile(filePath);

    this.showDebug(`YAML file parsed: ${filePath}`, data);

    if (data && data.tables) {
      const tables: HedhogTable[] = Object.keys(data.tables).map(
        (tableName) => ({
          name: tableName,
          columns: data.tables?.[tableName]?.columns || [],
          ifNotExists: data.tables?.[tableName].ifNotExists || false,
        }),
      );

      return tables;
    }

    return [];
  }

  private async updateParentModule(
    librayName: string,
    modulePath: string,
    newModuleName: string,
  ) {
    const sameNameModule = librayName === newModuleName;

    if (!modulePath) {
      console.error(chalk.red(`Parent module file not found.`));
      return;
    }

    newModuleName = newModuleName.toPascalCase();

    try {
      let moduleContent = await readFileSync(modulePath, 'utf8');

      moduleContent = await formatWithPrettier(moduleContent, {
        parser: 'typescript',
        printWidth: 100000,
        singleQuote: true,
        trailingComma: 'all',
        semi: true,
      });

      const importStatement = this.createImportStatement(
        newModuleName,
        sameNameModule,
      );
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

      if (sameNameModule) {
        importsList.push(
          `forwardRef(() => ${newModuleName.toPascalCase()}Module2)`,
        );
      } else {
        importsList.push(
          `forwardRef(() => ${newModuleName.toPascalCase()}Module)`,
        );
      }

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

  private createImportStatement(
    newModuleName: string,
    sameNameModule = false,
  ): string {
    if (sameNameModule) {
      return `import { ${newModuleName.toPascalCase()}Module as ${newModuleName.toPascalCase()}Module2 } from './${newModuleName.toKebabCase()}/${newModuleName.toKebabCase()}.module';`;
    } else {
      return `import { ${newModuleName.toPascalCase()}Module } from './${newModuleName.toKebabCase()}/${newModuleName.toKebabCase()}.module';`;
    }
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
