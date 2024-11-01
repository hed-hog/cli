import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { formatTypeScriptCode } from './format-typescript-code';
import { render } from 'ejs';
import { AbstractTable } from '../tables/abstract.table';

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
  fileType: 'controller' | 'service' | 'module',
  options: IOption = {
    useLibraryNamePath: false,
    importServices: false,
  },
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
    .map((field) => field.name);

  console.log({ fieldsForSearch });

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
    `${toKebabCase(tableName)}.${fileType}.ts`,
  );

  await fs.writeFile(fileFullPath, await formatTypeScriptCode(fileContent));
}
