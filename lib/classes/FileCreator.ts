import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from '../utils/convert-string-cases';
import { render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';
import { formatWithPrettier } from '../utils/format-with-prettier';
import { formatTypeScriptCode } from '../utils/format-typescript-code';
import hasLocaleYaml from '../utils/has-locale-yaml';
import getLocaleYaml from '../utils/get-fk-locale-yaml';

interface IOption {
  useLibraryNamePath?: boolean;
  importServices?: boolean;
  hasRelationsWith?: string;
  tablesWithRelations?: IRelation[];
  fields?: IFields[];
}

interface IRelation {
  name: string;
  relations: string[];
}

interface IFields {
  name: string;
  type: string;
}

export class FileCreator {
  private libraryPath: string;
  private tableName: string;
  private fileType: 'controller' | 'service' | 'module' | 'screen';
  private options: IOption;
  private hasLocale?: boolean;

  constructor(
    libraryPath: string,
    tableName: string,
    fileType: 'controller' | 'service' | 'module' | 'screen',
    options: IOption = {
      useLibraryNamePath: false,
      importServices: false,
      hasRelationsWith: '',
      tablesWithRelations: [],
    },
    hasLocale?: boolean,
  ) {
    this.libraryPath = libraryPath;
    this.tableName = tableName;
    this.fileType = fileType;
    this.options = options;
    this.hasLocale = hasLocale;
  }

  async createFile() {
    const filePath = path.join(
      this.libraryPath,
      this.options.hasRelationsWith ?? '',
      this.options.useLibraryNamePath ? toKebabCase(this.tableName) : 'src',
    );

    const tablesWithRelations = (this.options.tablesWithRelations ?? [])
      .map((t) => t.relations)
      .flat();

    if (
      tablesWithRelations.includes(this.tableName) &&
      this.fileType === 'module'
    ) {
      return;
    }

    if (
      this.options.tablesWithRelations &&
      this.options.tablesWithRelations.length &&
      this.options.tablesWithRelations[0].name === this.tableName &&
      this.fileType === 'module'
    ) {
      await this.createParentModuleFile(tablesWithRelations);
      return;
    }

    await fs.mkdir(filePath, { recursive: true });

    const fieldsForSearch = (this.options.fields ?? [])
      .map((field) => AbstractTable.getColumnOptions(field))
      .filter((field) => !['created_at', 'updated_at'].includes(field.name))
      .filter((field) => !field.references)
      .filter((field) => !field.isPrimary)
      .map((field) => field.name);

    const fileContent = await this.generateFileContent(fieldsForSearch);
    const fileFullPath = path.join(
      filePath,
      `${toKebabCase(this.tableName)}.${this.fileType}.ts`,
    );

    console.log('Creating file:', fileFullPath);

    await fs.writeFile(
      fileFullPath,
      await formatWithPrettier(fileContent, {
        parser: 'typescript',
        trailingComma: 'none',
        semi: true,
        singleQuote: true,
        printWidth: 80,
        tabWidth: 2,
        endOfLine: 'lf',
      }),
    );
  }

  private async createParentModuleFile(tablesWithRelations: string[]) {
    const parentModulePath = path.join(
      this.libraryPath,
      this.options.tablesWithRelations![0].name,
      `${this.options.tablesWithRelations![0].name}.module.ts`,
    );

    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      'templates',
      'module-related.ts.ejs',
    );

    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const data = {
      tableName: this.tableName,
      options: {
        importServices: true,
        tablesWithRelations,
      },
    };

    const renderedContent = render(templateContent, data);
    const formattedContent = await formatTypeScriptCode(renderedContent);
    await fs.writeFile(parentModulePath, formattedContent);
  }

  private async generateFileContent(fieldsForSearch: string[]) {
    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      'templates',
      `${this.fileType}.ts.ejs`,
    );

    const templateRelationsPath = path.join(
      __dirname,
      '..',
      '..',
      'templates',
      `${this.fileType}-related.ts.ejs`,
    );

    return render(
      await fs.readFile(
        this.options.hasRelationsWith && this.fileType !== 'module'
          ? templateRelationsPath
          : templatePath,
        'utf-8',
      ),
      {
        tableName: this.tableName,
        libraryName: this.tableName,
        fieldsForSearch,
        options: this.options,
        hasLocale: hasLocaleYaml(this.libraryPath, this.tableName),
        foreignKey: getLocaleYaml(this.libraryPath, this.tableName),
      },
    );
  }
}
