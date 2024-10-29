export function pluralize(word: string): string {
  if (word.endsWith('y')) {
    return word.slice(0, -1) + 'ies';
  }

  if (/(s|sh|ch|x|z)$/i.test(word)) {
    return word + 'es';
  }

  return word + 's';
}
