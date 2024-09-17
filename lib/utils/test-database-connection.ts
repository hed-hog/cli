export async function testDatabaseConnection(
  type: 'postgres' | 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
): Promise<boolean> {
  try {
    if (type === 'postgres') {
      const { Client } = await import('pg');
      const client = new Client({
        host,
        user,
        password,
        database,
        port,
      });
      await client.connect();
      await client.query('SELECT NOW()');
      await client.end();
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host,
        user,
        password,
        database,
        port,
      });
      await connection.query('SELECT NOW()');
      await connection.end();
    }
  } catch (error) {
    return false;
  }
  return true;
}
