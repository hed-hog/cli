import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { formatTypeScriptCode } from './format-typescript-code';
import { render } from 'ejs';
import { readFile } from 'fs/promises';

export async function createService(
  libraryPath: string,
  tableName: string,
  fields: { name: string; type: string }[],
) {
  const servicePath = path.join(libraryPath, toKebabCase(tableName));
  await fs.mkdir(servicePath, { recursive: true });

  const fieldNamesForSearch = ['name', 'email', 'title'];

  const fieldsForSearch = fields
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
    'service.ts.ejs',
  );

  const serviceContent = render(await readFile(templatePath, 'utf-8'), {
    tableName,
    fieldsForSearch,
  });

  const serviceFilePath = path.join(
    servicePath,
    `${toKebabCase(tableName)}.service.ts`,
  );
  await fs.writeFile(
    serviceFilePath,
    await formatTypeScriptCode(serviceContent),
  );
}
