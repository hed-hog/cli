import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { EMOJIS } from '../ui';

export async function parseEnvFile(envPath: string) {
  if (existsSync(envPath)) {
    const envFile = await readFile(envPath, 'utf-8');
    const envLines = envFile.split('\n');

    const env: any = {};

    for (const line of envLines) {
      const [key, value] = line.split('=');
      if (key && value) {
        env[key] = value.replaceAll(/['"]+/g, '');
      }
    }

    return env;
  } else {
    throw new Error(`${EMOJIS.ERROR} File .env not found.`);
  }
}
