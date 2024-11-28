declare global {
  interface String {
    toCamelCase(): string;
    toKebabCase(): string;
    toPascalCase(): string;
    toSnakeCase(): string;
    toScreamingSnakeCase(): string;
  }
}

String.prototype.toSnakeCase = function (): string {
  return this.replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, '_')
    .toLowerCase();
};

String.prototype.toKebabCase = function (): string {
  return this.replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, '-')
    .toLowerCase();
};

String.prototype.toPascalCase = function (): string {
  return this.replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(
      /(\w)(\w*)/g,
      (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase(),
    )
    .replace(/\s+/g, '');
};

String.prototype.toCamelCase = function (): string {
  return this.replace(/[-_]+/g, ' ')
    .replace(
      /(\w)(\w*)/g,
      (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase(),
    )
    .replace(/^(\w)/, (match) => match.toLowerCase())
    .replace(/\s+/g, '');
};

String.prototype.toScreamingSnakeCase = function (): string {
  return this.toSnakeCase().toUpperCase();
};

export {};
