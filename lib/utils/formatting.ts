import { Runner, RunnerFactory } from '../runners';

/**
 *
 * @param str
 * @returns formated string
 * @description normalizes input to supported path and file name format.
 * Changes camelCase strings to kebab-case, replaces spaces with dash and keeps underscores.
 */
export function normalizeToKebabOrSnakeCase(str: string) {
  const STRING_DASHERIZE_REGEXP = /\s/g;
  const STRING_DECAMELIZE_REGEXP = /([a-z\d])([A-Z])/g;
  return str
    .replace(STRING_DECAMELIZE_REGEXP, '$1-$2')
    .toLowerCase()
    .replace(STRING_DASHERIZE_REGEXP, '-');
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function prettier(path: string) {
  const npx = RunnerFactory.create(Runner.NPX);
  return npx?.run(`prettier --write ${path}`);
}
