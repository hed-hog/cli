import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { stringify } from 'yaml';
import { HedhogFile } from '../types/hedhog-file';

export const writeHedhogFile = async (
  basePath: string,
  content: HedhogFile,
) => {
  console.log('writeHedhogFile', {
    basePath,
  });

  if (basename(basePath) === 'hedhog.yaml') {
    basePath = join(basePath, '..');
  }

  console.log({ basePath });

  const props: (keyof HedhogFile)[] = ['tables', 'data', 'screens', 'enums'];

  for (const prop of props) {
    if (content?.[prop]) {
      for (const itemName of Object.keys(content[prop]!)) {
        if (existsSync(join(basePath, 'hedhog', prop, `${itemName}.yaml`))) {
          console.log(`Writing ${itemName}.yaml`);

          await writeFile(
            join(basePath, 'hedhog', prop, `${itemName}.yaml`),
            stringify((content[prop] as Record<string, any>)[itemName] ?? ''),
            'utf8',
          );

          console.log(`Deleting ${itemName} from ${prop}`);
          delete (content[prop] as Record<string, any>)[itemName];
        }
      }
    }
  }

  for (const prop of props) {
    if (existsSync(join(basePath, 'hedhog', `${prop}.yaml`)) && content[prop]) {
      console.log(`Writing ${prop}.yaml`);

      await writeFile(
        join(basePath, 'hedhog', `${prop}.yaml`),
        stringify(content[prop]),
        'utf8',
      );

      console.log(`Deleting ${prop}`);

      delete content[prop];
    }
  }

  if (existsSync(join(basePath, 'hedhog', `routes.yaml`)) && content.routes) {
    console.log(`Writing routes.yaml`);

    await writeFile(
      join(basePath, 'hedhog', 'routes.yaml'),
      stringify(content.routes),
      'utf8',
    );

    console.log(`Deleting routes`);

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

  console.log({ content });

  if (
    Object.keys(content.data ?? {}).length > 0 ||
    Object.keys(content.tables ?? {}).length > 0 ||
    Object.keys(content.screens ?? {}).length > 0 ||
    Object.keys(content.enums ?? {}).length > 0 ||
    (content.routes ?? []).length > 0
  ) {
    console.log(`Writing hedhog.yaml`);

    await writeFile(join(basePath, 'hedhog.yaml'), stringify(content), 'utf8');
  }

  return true;
};
