import { format, Options } from 'prettier';

export async function formatWithPrettier(code: string, options: Options = {}) {
  return format(code, {
    ...options,
  });
}
