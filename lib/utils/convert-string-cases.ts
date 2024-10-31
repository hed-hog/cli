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

export function singularize(word: string): string {
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y';
  } else if (word.endsWith('es')) {
    return word.slice(0, -2);
  } else if (word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}
