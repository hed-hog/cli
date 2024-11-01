import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { formatTypeScriptCode } from './format-typescript-code';
import { render } from 'ejs';

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

  const fieldNamesForSearch = ['name', 'email', 'title'];
  const fieldsForSearch = (options?.fields ?? [])
    .filter(
      (field) =>
        field.type === 'varchar' ||
        field.type === 'text' ||
        fieldNamesForSearch.includes(field.name),
    )
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
    `${toKebabCase(tableName)}.${fileType}.ts`,
  );

  await fs.writeFile(fileFullPath, await formatTypeScriptCode(fileContent));
}
