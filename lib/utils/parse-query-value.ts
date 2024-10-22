export default function parseQueryValue(value: any) {
  switch (typeof value) {
    case 'number':
    case 'boolean':
      return value;

    default:
      return `'${value}'`;
  }
}
