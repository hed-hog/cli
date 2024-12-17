import { format, Options } from 'prettier';

/**
 * Formats the given code with prettier.
 *
 * @param {string} code - The code to be formatted.
 * @param {import('prettier').Options} [options] - Optional options to be passed to prettier.
 * @returns {Promise<string>} Returns the formatted code as a string.
 */
export async function formatWithPrettier(code: string, options: Options = {}): Promise<string> {
  return format(code, {
    ...options,
  });
}
