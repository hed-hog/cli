import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { stringify } from 'yaml';
import { HedhogFile } from '../types/hedhog-file';

export const writeHedhogFile = async (
  basePath: string,
  content: HedhogFile,
) => {
  if (basename(basePath) === 'hedhog.yaml') {
    basePath = join(basePath, '..');
  }

  const props: (keyof HedhogFile)[] = ['tables', 'data', 'screens', 'enums'];

  for (const prop of props) {
    if (content?.[prop]) {
      for (const itemName of Object.keys(content[prop]!)) {
        if (existsSync(join(basePath, 'hedhog', prop, `${itemName}.yaml`))) {
          await writeFile(
            join(basePath, 'hedhog', prop, `${itemName}.yaml`),
            stringify((content[prop] as Record<string, any>)[itemName] ?? ''),
            'utf8',
          );

          delete (content[prop] as Record<string, any>)[itemName];
        }
      }
    }
  }

  for (const prop of props) {
    if (existsSync(join(basePath, 'hedhog', `${prop}.yaml`)) && content[prop]) {
      await writeFile(
        join(basePath, 'hedhog', `${prop}.yaml`),
        stringify(content[prop]),
        'utf8',
      );

      delete content[prop];
    }
  }

  if (existsSync(join(basePath, 'hedhog', `routes.yaml`)) && content.routes) {
    await writeFile(
      join(basePath, 'hedhog', 'routes.yaml'),
      stringify(content.routes),
      'utf8',
    );

    delete content.routes;
  }

  for (const prop of props) {
    if (Object.keys(content[prop] ?? {}).length === 0) {
      delete content[prop];
    }
  }

  if ((content.routes ?? []).length === 0) {
    delete content.routes;
  }

  if (
    Object.keys(content.data ?? {}).length > 0 ||
    Object.keys(content.tables ?? {}).length > 0 ||
    Object.keys(content.screens ?? {}).length > 0 ||
    Object.keys(content.enums ?? {}).length > 0 ||
    (content.routes ?? []).length > 0
  ) {
    await writeFile(join(basePath, 'hedhog.yaml'), stringify(content), 'utf8');
  }

  return true;
};
