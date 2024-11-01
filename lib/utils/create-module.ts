import * as fs from 'fs/promises';
import * as path from 'path';
import { toKebabCase } from './convert-string-cases';
import { formatTypeScriptCode } from './format-typescript-code';
import { render } from 'ejs';

interface IOption {
  useLibraryNamePath: boolean;
  importServices: boolean;
}

export async function createModule(
  libraryPath: string,
  libraryName: string,
  options: IOption = {
    useLibraryNamePath: false,
    importServices: false,
  },
) {
  const modulePath = path.join(
    libraryPath,
    options.useLibraryNamePath ? toKebabCase(libraryName) : 'src',
  );
  await fs.mkdir(modulePath, { recursive: true });

  const templatePath = path.join(
    __dirname,
    '..',
    '..',
    'templates',
    'module.ts.ejs',
  );

  const moduleContent = render(await fs.readFile(templatePath, 'utf-8'), {
    libraryName,
    options,
  });

  const moduleFilePath = path.join(
    modulePath,
    `${toKebabCase(libraryName)}.module.ts`,
  );
  await fs.writeFile(moduleFilePath, await formatTypeScriptCode(moduleContent));
}
