import { format, Options } from 'prettier';

export async function formatTypeScriptCode(
  code: string,
  options: Options = {},
) {
  return format(code, {
    parser: 'typescript',
    ...options,
  });
}
