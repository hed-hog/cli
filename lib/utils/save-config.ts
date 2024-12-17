import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

export const saveConfig = async (config: any) => {
  const dirPath = join(homedir(), '.hedhog', 'config.yaml');
  if (!existsSync(dirPath)) {
    await writeFile(dirPath, stringify({ tokens: {} }, { indent: 2 }), 'utf-8');
  }

  const currentConfig = parse(await readFile(dirPath, 'utf-8'));

  const data = Object.assign({}, currentConfig, config);

  console.log('saveConfig', data);

  await writeFile(dirPath, stringify(data, { indent: 2 }), 'utf-8');

  return data;
};
