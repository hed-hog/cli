import parseQueryValue from './parse-query-value';

export default function objectToWhereClause(obj: any) {
  let whereClause = '';

  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      whereClause += `${key} ${obj[key].operator} ${parseQueryValue(obj[key].value)}`;
    } else {
      whereClause += `${key} = ${parseQueryValue(obj[key])}`;
    }
  }

  return whereClause;
}
