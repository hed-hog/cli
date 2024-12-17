import { FieldPacket } from 'mysql2';
import { QueryResult } from 'typeorm';

/**
 * Execute a SQL query on a database.
 *
 * @param {string} type The type of database. Either 'postgres' or 'mysql'.
 * @param {string} host The hostname of the database.
 * @param {number} port The port number of the database.
 * @param {string} user The username to use to connect to the database.
 * @param {string} password The password to use to connect to the database.
 * @param {string} database The name of the database to use.
 * @param {string} query The SQL query to execute.
 *
 * @returns {Promise<import('pg').QueryResult | import('mysql2').RowDataPacket[][] | boolean | [QueryResult, FieldPacket[]]>}
 *   The result of the query if the query was successful, otherwise false.
 */
export async function executeQueryDatabase(
  type: 'postgres' | 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
  query: string,
): Promise<import('pg').QueryResult | import('mysql2').RowDataPacket[][] | boolean | [QueryResult, FieldPacket[]]> {
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
      const result = await client.query(query);
      await client.end();
      return result;
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host,
        user,
        password,
        database,
        port,
      });
      const result = await connection.query(query) as unknown as [QueryResult, FieldPacket[]];
      await connection.end();
      return result;
    }
  } catch (error) {
    return false;
  }
  return true;
}
