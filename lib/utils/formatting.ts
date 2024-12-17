import { Runner, RunnerFactory } from '../runners';

/**
 *
 * @param str
 * @returns formated string
 * @description normalizes input to supported path and file name format.
 * Changes camelCase strings to kebab-case, replaces spaces with dash and keeps underscores.
 * @returns {string}
 */
export function normalizeToKebabOrSnakeCase(str: string): string {
  const STRING_DASHERIZE_REGEXP = /\s/g;
  const STRING_DECAMELIZE_REGEXP = /([a-z\d])([A-Z])/g;
  return str
    .replace(STRING_DECAMELIZE_REGEXP, '$1-$2')
    .toLowerCase()
    .replace(STRING_DASHERIZE_REGEXP, '-');
}


/**
 * Capitalizes the first character of the given string.
 *
 * @param str - The string to capitalize.
 * @returns The input string with the first character capitalized.
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


/**
 * Runs prettier on the given path.
 *
 * @param {string} path - The path to a file or directory to run prettier on.
 * @returns {Promise<string|undefined|null>} Resolves when the command has finished running.
 * @description Uses the npx bin to run prettier. If npx is not available, the function will return undefined.
 */
export async function prettier(path: string): Promise<string | undefined | null> {
  const npx = RunnerFactory.create(Runner.NPX);
  return npx?.run(`prettier --write ${path}`);
}
