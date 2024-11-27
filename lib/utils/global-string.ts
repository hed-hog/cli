declare global {
  interface String {
    toCamelCase(): string;
    toKebabCase(): string;
    toPascalCase(): string;
    toSnakeCase(): string;
    toScreamingSnakeCase(): string;
  }
}

String.prototype.toCamelCase = function (): string {
  return this.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (match, index) =>
    index === 0 ? match.toLowerCase() : match.toUpperCase(),
  ).replace(/\s+/g, '');
};

String.prototype.toKebabCase = function (): string {
  return this.replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
};

String.prototype.toPascalCase = function (): string {
  return this.replace(
    /(\w)(\w*)/g,
    (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase(),
  ).replace(/\s+/g, '');
};

String.prototype.toSnakeCase = function (): string {
  return this.replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .toLowerCase();
};

String.prototype.toScreamingSnakeCase = function (): string {
  return this.toSnakeCase().toUpperCase();
};

export {};
