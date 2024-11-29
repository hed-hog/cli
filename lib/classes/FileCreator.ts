import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase, toObjectCase } from '../utils/convert-string-cases';
import { render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';
import { formatWithPrettier } from '../utils/format-with-prettier';
import { formatTypeScriptCode } from '../utils/format-typescript-code';
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
      this.options.useLibraryNamePath ? this.table.name.toKebabCase() : 'src',
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
      `${this.table.name.toKebabCase()}.${this.fileType}.ts`,
    );

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
      'module',
      'module-related.ts.ejs',
    );

    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const data = {
      tableNameCase: toObjectCase(this.table.name),
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
    const templatePath = path.join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}.ts.ejs`,
    );
    const templateRelationsPath = path.join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}-related.ts.ejs`,
    );
    const templateRelationsLocalePath = path.join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}-related-locale.ts.ejs`,
    );
    const templateLocalePath = path.join(
      baseTemplatePath,
      this.fileType,
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
      module: {
        imports: this.options.importServices
          ? [
              `import { ${this.table.name.toPascalCase()}Service } from './${this.table.name.toKebabCase()}.service'`,
              `import { ${this.table.name.toPascalCase()}Controller } from './${this.table.name.toKebabCase()}.controller';`,
            ]
          : [],
        controllers: this.options.importServices
          ? [`${this.table.name.toPascalCase()}Controller`]
          : [],
        providers: this.options.importServices
          ? [`${this.table.name.toPascalCase()}Service`]
          : [],
        exports: this.options.importServices
          ? [`${this.table.name.toPascalCase()}Service`]
          : [],
      },
    };
    for (const field in vars) {
      if (typeof vars[field] === 'string' && field.endsWith('Case')) {
        vars[field] = toObjectCase(vars[field]);
      }
    }

    return render(await fs.readFile(this.getTemplatePath(), 'utf-8'), vars);
  }
}
