import * as fs from 'fs';
import path = require('path');
import * as yaml from 'yaml';

function getLocaleYaml(libraryPath: string, name: string) {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const data = yaml.parse(fileContents) as Record<string, any>;
    const key = `${name}_locale`;

    if (data.tables[key]) {
      for (const column of data.tables[key].columns) {
        if (column.references && column.references.table === name) {
          return column.name;
        }
      }
    }

    return false;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export default getLocaleYaml;
