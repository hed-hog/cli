import * as fs from 'node:fs';
import { join } from 'node:path';

const TSCONFIG_BUILD_JSON = 'tsconfig.build.json';
const TSCONFIG_JSON = 'tsconfig.json';

export function getDefaultTsconfigPath() {
  return fs.existsSync(join(process.cwd(), TSCONFIG_BUILD_JSON))
    ? TSCONFIG_BUILD_JSON
    : TSCONFIG_JSON;
}
