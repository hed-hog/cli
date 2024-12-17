import { format, Options } from 'prettier';

/**
 * Formats the given TypeScript code with Prettier.
 *
 * @param {string} code - The code to be formatted.
 * @param {import('prettier').Options} [options] - Optional options to be passed to Prettier.
 * @returns {Promise<string>} Returns the formatted code as a string.
 */
export async function formatTypeScriptCode(
  code: string,
  options: Options = {},
): Promise<string> {
  return format(code, {
    parser: 'typescript',
    ...options,
  });
}
