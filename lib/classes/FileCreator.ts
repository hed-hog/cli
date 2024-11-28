import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase, toObjectCase } from '../utils/convert-string-cases';
import { render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';
import { formatWithPrettier } from '../utils/format-with-prettier';
import { formatTypeScriptCode } from '../utils/format-typescript-code';
import hasLocaleYaml from '../utils/has-locale-yaml';
import getLocaleYaml from '../utils/get-fk-locale-yaml';
import { TableApply } from './TableApply';

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
  private table: TableApply;
  private fileType: 'controller' | 'service' | 'module' | 'screen';
  private options: IOption;

  constructor(
    libraryPath: string,
    table: TableApply,
    fileType: 'controller' | 'service' | 'module' | 'screen',
    options: IOption = {
      useLibraryNamePath: false,
      importServices: false,
      hasRelationsWith: '',
      tablesWithRelations: [],
    },
  ) {
    this.libraryPath = libraryPath;
    this.table = table;
    this.fileType = fileType;
    this.options = options;
  }

  async createFile() {
    const filePath = path.join(
      this.libraryPath,
      this.options.hasRelationsWith ?? '',
      this.options.useLibraryNamePath ? toKebabCase(this.table.name) : 'src',
    );

    const tablesWithRelations = (this.options.tablesWithRelations ?? [])
      .map((t) => t.relations)
      .flat();

    if (
      tablesWithRelations.includes(this.table.name) &&
      this.fileType === 'module'
    ) {
      return;
    }

    if (
      this.options.tablesWithRelations &&
      this.options.tablesWithRelations.length &&
      this.options.tablesWithRelations[0].name === this.table.name &&
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
      `${toKebabCase(this.table.name)}.${this.fileType}.ts`,
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
      tableName: this.table.name,
      options: {
        importServices: true,
        tablesWithRelations,
      },
    };

    const renderedContent = render(templateContent, data);
    const formattedContent = await formatTypeScriptCode(renderedContent);
    await fs.writeFile(parentModulePath, formattedContent);
  }

  private getTemplatePath() {
    const baseTemplatePath = path.join(__dirname, '..', '..', 'templates');
    const templatePath = path.join(baseTemplatePath, `${this.fileType}.ts.ejs`);
    const templateRelationsPath = path.join(
      baseTemplatePath,
      `${this.fileType}-related.ts.ejs`,
    );
    const templateRelationsLocalePath = path.join(
      baseTemplatePath,
      `${this.fileType}-related-locale.ts.ejs`,
    );
    const templateLocalePath = path.join(
      baseTemplatePath,
      `${this.fileType}-locale.ts.ejs`,
    );

    if (this.fileType === 'module') {
      return this.options.hasRelationsWith
        ? templateRelationsPath
        : templatePath;
    }

    if (this.table.hasLocale) {
      return this.options.hasRelationsWith
        ? templateRelationsLocalePath
        : templateLocalePath;
    }

    return this.options.hasRelationsWith ? templateRelationsPath : templatePath;
  }

  private async generateFileContent(fieldsForSearch: string[]) {
    const vars: any = {
      tableNameCase: this.table.name,
      fieldsForSearch,
      relatedTableNameCase: String(this.options.hasRelationsWith),
      options: this.options,
      fkNameCase: this.table.fkName,
      pkNameCase: this.table.pkName,
      hasLocale: this.table.hasLocale,
      fkNameLocaleCase: getLocaleYaml(this.libraryPath, this.table.name),
    };
    for (const field in vars) {
      if (typeof vars[field] === 'string' && field.endsWith('Case')) {
        vars[field] = toObjectCase(vars[field]);
      }
    }

    console.log({ vars, template: this.getTemplatePath() });
    return render(await fs.readFile(this.getTemplatePath(), 'utf-8'), vars);
  }
}
