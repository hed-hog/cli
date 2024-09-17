import { format, Options } from 'prettier';

export async function formatTypeScriptCode(
  code: string,
  options: Options = {},
) {
  console.log('formatTypeScriptCode', code, options);

  return format(code, {
    parser: 'typescript',
    ...options,
  });
}
