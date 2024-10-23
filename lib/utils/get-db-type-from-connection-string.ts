import { Database } from '../databases';

export function getDbTypeFromConnectionString(
  connectionString: string,
): Database {
  const protocol = connectionString.split(':')[0];

  switch (protocol) {
    case 'postgres':
    case 'postgresql':
      return Database.POSTGRES;
    case 'mysql':
      return Database.MYSQL;
    default:
      throw new Error(`Database type not supported: ${protocol}`);
  }
}
