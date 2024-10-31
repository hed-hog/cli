export function toCamelCase(str: string): string {
  return str
    .replace(/([-_][a-z])/gi, (match) => {
      return match.toUpperCase().replace('-', '').replace('_', '');
    })
    .replace(/^[A-Z]/, (match) => match.toLowerCase());
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '')
    .replace(/[-]/g, '_');
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^[-_]/, '')
    .replace(/[_]/g, '-');
}

export function toPascalCase(str: string): string {
  return str.replace(/(^\w|[-_]\w)/g, (match) =>
    match.replace(/[-_]/, '').toUpperCase(),
  );
}
