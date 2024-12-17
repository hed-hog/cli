import { access, readFile } from 'fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import chalk = require('chalk');

export const getConfig = async (path: string) => {
  const dirPath = join(homedir(), '.hedhog');
  const configPath = join(dirPath, 'config.yaml');

  try {
    await access(dirPath);
    await access(configPath);
  } catch (err) {
    chalk.red('Configuration file not found');
    return;
  }

  const content = parse(await readFile(configPath, 'utf-8'));

  const getPathValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  return getPathValue(content, path);
};
