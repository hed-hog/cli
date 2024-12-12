import * as fs from 'fs/promises';
import * as path from 'path';
import { toObjectCase } from '../utils/convert-string-cases';
import { name, render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';
import { formatWithPrettier } from '../utils/format-with-prettier';
import { formatTypeScriptCode } from '../utils/format-typescript-code';
import getLocaleYaml from '../utils/get-fk-locale-yaml';
import { TableApply } from './TableApply';
import { filterScreenCreation } from '../utils/filter-screen-creation';
import { Column } from '../types/column';
import { Table } from '../types/table';

interface IOption {
  useLibraryNamePath?: boolean;
  importServices?: boolean;
  hasRelationsWith?: string;
  tablesWithRelations?: IRelation[];
  localeTables?: any[];
}

interface IRelation {
  name: string;
  relations: string[];
}

interface IFields {
  name: string;
  isLocale: boolean;
}

type FileType = 'controller' | 'service' | 'module' | 'screen';

export class FileCreator {
  private libraryPath: string;
  private libraryName: string;
  private table: TableApply;
  private fileType: 'controller' | 'service' | 'module' | 'screen';
  private options: IOption;
  private fieldsForSearch: IFields[];

  constructor(
    libraryPath: string,
    libraryName: string,
    table?: TableApply,
    fileType?: 'controller' | 'service' | 'module' | 'screen',
    options: IOption = {
      useLibraryNamePath: false,
      importServices: false,
      hasRelationsWith: '',
      tablesWithRelations: [],
      localeTables: [],
    },
  ) {
    this.libraryPath = libraryPath;
    this.libraryName = libraryName;
    this.table = table as TableApply;
    this.fileType = fileType as FileType;
    this.options = options;
    this.fieldsForSearch = [];
  }

  private getFileFullPath(): string {
    if (this.fileType === 'screen') {
      return path.join(
        this.getFilePath(),
        '..',
        '..',
        'frontend',
        `${this.table.name.toKebabCase()}`,
        'components',
        `${this.table.name.toKebabCase()}.${this.fileType}.tsx.ejs`,
      );
    }

    return path.join(
      this.getFilePath(),
      `${this.table.name.toKebabCase()}.${this.fileType}.ts`,
    );
  }

  private filterFields(array: Column[]) {
    return array
      .map((field) => AbstractTable.getColumnOptions(field))
      .filter((field) => !['created_at', 'updated_at'].includes(field.name))
      .filter((field) => !field.references)
      .filter((field) => !field.isPrimary)
      .map((field) => {
        return {
          name: field.name,
          isLocale: false,
        };
      });
  }

  private getFilePath(): string {
    if (this.fileType === 'screen') {
      return path.join(this.libraryPath, this.table.name.toKebabCase());
    }

    return path.join(
      this.libraryPath,
      this.options.hasRelationsWith ?? '',
      this.options.useLibraryNamePath ? this.table.name.toKebabCase() : 'src',
    );
  }

  async createFile() {
    if (this.fileType === 'screen') {
      if (!(await filterScreenCreation(this.libraryPath, this.table.name))) {
        return;
      }
    }

    const filePath = this.getFilePath();
    await fs.mkdir(filePath, { recursive: true });
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

    if (this.table.getColumns !== undefined) {
      this.fieldsForSearch = this.filterFields(this.table.getColumns());
    }

    let localeTable = null;
    if (this.table.hasLocale && this.options.localeTables) {
      localeTable = this.options.localeTables.find(
        (locale) => locale.name === `${this.table.name}_locale`,
      );
    }

    if (localeTable) {
      const fieldLocaleTable = localeTable.columns.find(
        (c: Column) => c.locale,
      )?.name;

      if (fieldLocaleTable) {
        this.fieldsForSearch = [
          ...this.fieldsForSearch,
          {
            name: fieldLocaleTable,
            isLocale: true,
          },
        ];
      }
    }

    const fileContent = await this.generateFileContent();
    const fileFullPath = this.getFileFullPath();
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

    if (this.fileType === 'screen') {
      return templatePath;
    }

    if (this.table.hasLocale) {
      return this.options.hasRelationsWith
        ? templateRelationsLocalePath
        : templateLocalePath;
    }

    return this.options.hasRelationsWith ? templateRelationsPath : templatePath;
  }

  private async generateFileContent() {
    const vars: any = {
      tableNameCase: this.table.name,
      fieldsForSearch:
        this.fileType === 'screen'
          ? this.fieldsForSearch
          : this.fieldsForSearch.map((f) => f.name),
      relatedTableNameCase: String(this.options.hasRelationsWith),
      options: this.options,
      fkNameCase: this.table.fkName,
      pkNameCase: this.table.pkName,
      hasLocale: this.table.hasLocale,
      libraryName: this.libraryName,
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
