import * as fs from 'fs';
import path = require('path');
import * as yaml from 'yaml';

function hasLocaleYaml(libraryPath: string, name: string): boolean {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const data = yaml.parse(fileContents) as Record<string, any>;
    const key = `${name}_locale`;
    return key in data.tables;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export default hasLocaleYaml;
