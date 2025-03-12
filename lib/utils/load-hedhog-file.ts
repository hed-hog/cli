import { existsSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { basename, join } from 'path';
import { parse } from 'yaml';
import { HedhogFile } from '../types/hedhog-file';
import chalk = require('chalk');

async function loadYaml(path: string) {
  if (!existsSync(path)) {
    return null;
  }
  const content = await readFile(path, 'utf8');
  return parse(content);
}

async function loadYamlFromDirectory(dirPath: string) {
  const items: Record<string, any> = {};
  if (existsSync(dirPath) && (await stat(dirPath)).isDirectory()) {
    const files = (await readdir(dirPath)).filter((f) => f.endsWith('.yaml'));
    for (const fileName of files) {
      const name = basename(fileName, '.yaml');
      items[name] = await loadYaml(join(dirPath, fileName));
    }
  }
  return items;
}

export async function loadHedhogFile(basePath: string): Promise<HedhogFile> {
  if (basename(basePath) === 'hedhog.yaml') {
    basePath = join(basePath, '..');
  }

  const hedgehogYaml = join(basePath, 'hedhog.yaml');
  const config: HedhogFile = {
    tables: {},
    data: {},
    enums: {},
    screens: {},
    routes: [],
  };

  // Arquivos simples
  const [hedhog, tables, data, screens, routes] = await Promise.all([
    loadYaml(hedgehogYaml),
    loadYaml(join(basePath, 'hedhog', 'tables.yaml')),
    loadYaml(join(basePath, 'hedhog', 'data.yaml')),
    loadYaml(join(basePath, 'hedhog', 'screens.yaml')),
    loadYaml(join(basePath, 'hedhog', 'routes.yaml')),
  ]);

  Object.assign(config, hedhog);

  if (tables?.tables) Object.assign({}, config.tables, tables.tables);
  if (data?.data) Object.assign({}, config.data, data.data);
  if (screens?.screens) Object.assign({}, config.screens, screens.screens);
  if (routes?.routes) config.routes?.push(...routes.routes);

  // Pastas com múltiplos arquivos
  const [tablesDir, dataDir, screensDir, routesDir] = await Promise.all([
    loadYamlFromDirectory(join(basePath, 'hedhog', 'tables')),
    loadYamlFromDirectory(join(basePath, 'hedhog', 'data')),
    loadYamlFromDirectory(join(basePath, 'hedhog', 'screens')),
    loadYamlFromDirectory(join(basePath, 'hedhog', 'routes')),
  ]);

  // Mescla os objetos retornados das pastas
  for (const [tableName, details] of Object.entries(tablesDir)) {
    if (config.tables && details?.columns) config.tables[tableName] = details;
  }
  for (const [dataName, details] of Object.entries(dataDir)) {
    if (details && config.data) {
      config.data[dataName] = details;
    }
  }
  for (const [screenName, details] of Object.entries(screensDir)) {
    if (details && config.screens) config.screens[screenName] = details;
  }
  for (const details of Object.values(routesDir)) {
    if (details?.routes) {
      config.routes = config.routes || [];
      config.routes.push(...details.routes);
    }
  }

  return config;
}
