import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';

export const getConfig = async (path: string) => {
  const dirPath = join(homedir(), '.hedhog');
  const configPath = join(dirPath, 'config.yaml');

  const content = parse(await readFile(configPath, 'utf-8'));

  const getPathValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  return getPathValue(content, path);
};
