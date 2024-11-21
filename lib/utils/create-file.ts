import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';
import { formatWithPrettier } from './format-with-prettier';
import { formatTypeScriptCode } from './format-typescript-code';
import hasLocaleYaml from './has-locale-yaml';
import getLocaleYaml from './get-fk-locale-yaml';

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

export async function createFile(
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
  const filePath = path.join(
    libraryPath,
    options?.hasRelationsWith ?? '',
    options?.useLibraryNamePath ? toKebabCase(tableName) : 'src',
  );

  if (
    options.tablesWithRelations &&
    options.tablesWithRelations[0].name === tableName &&
    fileType === 'module'
  ) {
    const parentModulePath = path.join(
      libraryPath,
      options.tablesWithRelations[0].name,
      `${options.tablesWithRelations[0].name}.module.ts`,
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
      tableName,
      options: {
        importServices: true,
        tablesWithRelations: options.tablesWithRelations
          .map((t) => t.relations)
          .flat(),
      },
    };

    const renderedContent = render(templateContent, data);
    const formattedContent = await formatTypeScriptCode(renderedContent);
    await fs.writeFile(parentModulePath, formattedContent);

    return;
  }

  await fs.mkdir(filePath, { recursive: true });
  const fieldsForSearch = (options?.fields ?? [])
    .map((field) => AbstractTable.getColumnOptions(field))
    .filter((field) => !['created_at', 'updated_at'].includes(field.name))
    .filter((field) => !field.references)
    .filter((field) => !field.isPrimary)
    .map((field) => field.name);

  const templatePath = path.join(
    __dirname,
    '..',
    '..',
    'templates',
    `${fileType}.ts.ejs`,
  );

  const templateRelationsPath = path.join(
    __dirname,
    '..',
    '..',
    'templates',
    `${fileType}-related.ts.ejs`,
  );

  let listFunction = '';

  if (fileType === 'service') {
    listFunction = render(
      await fs.readFile(
        path.join(
          __dirname,
          '..',
          '..',
          'templates',
          Boolean(hasLocale)
            ? 'list-service-locale.ts.ejs'
            : 'list-service.ts.ejs',
        ),
        'utf-8',
      ),
      {
        tableName,
        fieldsForSearch,
        libraryName: tableName,
        translationTableName: `${tableName}_locale`,
        options,
      },
    );
  }

  const fileContent = render(
    await fs.readFile(
      options.hasRelationsWith && fileType !== 'module'
        ? templateRelationsPath
        : templatePath,
      'utf-8',
    ),
    {
      tableName,
      libraryName: tableName,
      fieldsForSearch,
      options,
      listFunction,
      hasLocale: hasLocaleYaml(libraryPath, tableName),
      foreignKey: getLocaleYaml(libraryPath, tableName),
    },
  );

  const fileFullPath = path.join(
    filePath,
    `${toKebabCase(tableName)}.${fileType}.ts`,
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
