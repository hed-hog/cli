import { loadHedhogFile } from './load-hedhog-file';
import path = require('node:path');

async function getLocaleYaml(libraryPath: string, name: string) {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');

    const data = await loadHedhogFile(filePath);

    const key = `${name}_locale`;

    if (data.tables?.[key]) {
      for (const column of data.tables[key].columns) {
        if (
          column &&
          'references' in column &&
          column.references.table === name
        ) {
          return column.name;
        }
      }
    }

    return '';
  } catch (e) {
    return '';
  }
}

export default getLocaleYaml;
