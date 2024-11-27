export function toCamelCase(str: string): string {
  console.warn('toCamelCase is deprecated. Use toPascalCase instead.');
  return str.toCamelCase();
}

export function toSnakeCase(str: string): string {
  console.warn('toSnakeCase is deprecated. Use toKebabCase instead.');
  return str.toSnakeCase();
}

export function toKebabCase(str: string): string {
  console.warn('toKebabCase is deprecated. Use toKebabCase instead.');
  return str.toKebabCase();
}

export function toPascalCase(str: string): string {
  console.warn('toPascalCase is deprecated. Use toPascalCase instead.');
  return str.toPascalCase();
}

export function toObjectCase(value: string) {
  return {
    value,
    toCamelCase: value.toCamelCase(),
    toSnakeCase: value.toSnakeCase(),
    toKebabCase: value.toKebabCase(),
    toPascalCase: value.toPascalCase(),
    toScreamingSnakeCase: value.toScreamingSnakeCase(),
  };
}

export function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
