import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';
import { formatWithPrettier } from './format-with-prettier';

interface IOption {
  useLibraryNamePath?: boolean;
  importServices?: boolean;
  fields?: IFields[];
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
  },
  hasLocale?: boolean,
) {
  const filePath = path.join(
    libraryPath,
    options?.useLibraryNamePath ? toKebabCase(tableName) : 'src',
  );
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

  const fileContent = render(await fs.readFile(templatePath, 'utf-8'), {
    tableName,
    libraryName: tableName,
    fieldsForSearch,
    options,
    listFunction,
  });

  const fileFullPath = path.join(
    filePath,
    `${toKebabCase(tableName)}.${fileType}.ts`,
  );

  console.log('Creating file:', fileFullPath);

  await fs.writeFile(
    fileFullPath,
    await formatWithPrettier(fileContent, {
      parser: 'typescript',
    }),
  );
}
