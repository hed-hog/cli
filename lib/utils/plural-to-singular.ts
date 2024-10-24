export function pluralToSingular(word: string) {
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y';
  } else if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }

  if (word === 'children') {
    return 'child';
  } else if (word === 'men') {
    return 'man';
  } else if (word === 'women') {
    return 'woman';
  } else if (word === 'feet') {
    return 'foot';
  } else if (word === 'teeth') {
    return 'tooth';
  } else if (word === 'mice') {
    return 'mouse';
  } else if (word === 'geese') {
    return 'goose';
  }

  return word;
}
