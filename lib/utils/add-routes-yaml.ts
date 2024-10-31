import * as fs from 'fs';
import * as yaml from 'yaml';
import { toKebabCase } from './convert-string-cases';
import path = require('path');

interface Route {
  url: string;
  method: string;
}

interface HedhogData {
  routes?: Route[];
}

interface HedhogYaml {
  data?: HedhogData;
}

export const addRoutesToYaml = (
  libraryPath: string,
  tableName: string,
): void => {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const yamlData: HedhogYaml = yaml.parse(fileContents) as HedhogYaml;

    if (!yamlData.data) {
      yamlData.data = {};
    }

    if (!yamlData.data.routes) {
      yamlData.data.routes = [];
    }

    const newRoutes: Route[] = [
      { url: `/${toKebabCase(tableName)}`, method: 'GET' },
      { url: `/${toKebabCase(tableName)}`, method: 'POST' },
      { url: `/${toKebabCase(tableName)}/:id`, method: 'GET' },
      { url: `/${toKebabCase(tableName)}/:id`, method: 'PATCH' },
      { url: `/${toKebabCase(tableName)}/:id`, method: 'DELETE' },
    ];
    yamlData.data.routes.push(...newRoutes);
    const newYamlContent = yaml.stringify(yamlData);
    fs.writeFileSync(filePath, newYamlContent, 'utf8');
    console.log('Routes added successfully.');
  } catch (error) {
    console.error('Error processing the YAML file:', error);
  }
};
