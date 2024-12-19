import * as fs from 'node:fs';
import * as yaml from 'yaml';
import path = require('node:path');

function getLocaleYaml(libraryPath: string, name: string) {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');

    if (!fs.existsSync(filePath)) {
      return '';
    }

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

    return '';
  } catch (e) {
    return '';
  }
}

export default getLocaleYaml;
