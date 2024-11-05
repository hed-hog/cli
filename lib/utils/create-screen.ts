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
export async function createScreen(
  libraryPath: string,
  tableName: string,
  fileType: 'screen',
  options: IOption = {
    importServices: false,
  },
  hasLocale?: boolean,
) {
  const filePath = path.join(libraryPath, toKebabCase(tableName), 'components');
  await fs.mkdir(filePath, { recursive: true });
  const fieldsForSearch = (options?.fields ?? [])
    .map((field) => AbstractTable.getColumnOptions(field))
    .filter((field) => !['created_at', 'updated_at'].includes(field.name))
    .filter((field) => !field.references)
    .map((field) => field.name);

  const templatePath = path.join(
    __dirname,
    '..',
    '..',
    'templates',
    `${fileType}.ts.ejs`,
  );

  const fileContent = render(await fs.readFile(templatePath, 'utf-8'), {
    tableName,
    libraryName: tableName,
    fieldsForSearch,
    options,
  });

  const fileFullPath = path.join(
    filePath,
    `${toKebabCase(tableName)}.${fileType}.tsx.ejs`,
  );

  console.log('Creating file:', fileFullPath);

  await fs.writeFile(
    fileFullPath,
    await formatWithPrettier(fileContent, {
      parser: 'typescript',
    }),
  );
}
