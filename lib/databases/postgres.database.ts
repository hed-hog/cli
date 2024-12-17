import { AbstractDatabase } from './abstract.database';
import { Database } from './database';

export class PostgresDatabase extends AbstractDatabase {
  /**
   * Creates a new PostgresDatabase instance
   *
   * @param host - The host of the Postgres database
   * @param user - The username to use to connect to the Postgres database
   * @param password - The password to use to connect to the Postgres database
   * @param database - The name of the database to use
   * @param port - The port number to use to connect to the Postgres database
   */
  constructor(
    protected host: string,
    protected user: string,
    protected password: string,
    protected database: string,
    protected port: number,
  ) {
    super(Database.POSTGRES, host, user, password, database, port);
  }
}
