import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { formatTypeScriptCode } from './format-typescript-code';
import { render } from 'ejs';

export async function createController(libraryPath: string, tableName: string) {
  const controllerPath = path.join(libraryPath, toKebabCase(tableName));
  await fs.mkdir(controllerPath, { recursive: true });

  const templatePath = path.join(
    __dirname,
    '..',
    '..',
    'templates',
    'controller.ts.ejs',
  );

  const controllerContent = render(await fs.readFile(templatePath, 'utf-8'), {
    tableName,
  });

  const controllerFilePath = path.join(
    controllerPath,
    `${toKebabCase(tableName)}.controller.ts`,
  );
  await fs.writeFile(
    controllerFilePath,
    await formatTypeScriptCode(controllerContent),
  );
}
