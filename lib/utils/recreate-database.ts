export async function recreateDatabase(
  type: 'postgres' | 'postgresql' | 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
) {
  try {
    if (type === 'postgres' || type === 'postgresql') {
      const { Client } = await import('pg');
      const client = new Client({
        host,
        user,
        password,
        port,
        database,
      });
      await client.connect();
      await client.query('DROP SCHEMA public CASCADE;');
      await client.query('CREATE SCHEMA public;');
      //await client.query('GRANT ALL ON SCHEMA public TO postgres;');
      //await client.query('GRANT ALL ON SCHEMA public TO public;');
      await client.end();
      return true;
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host,
        user,
        password,
        port,
      });
      console.log('recreateDatabase', 'connected');
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\`;`);
      console.log('recreateDatabase', 'dropped');
      await connection.query(`CREATE DATABASE \`${database}\`;`);
      console.log('recreateDatabase', 'created');
      await connection.end();
      return true;
    }
  } catch (error) {
    return false;
  }
  return true;
}
