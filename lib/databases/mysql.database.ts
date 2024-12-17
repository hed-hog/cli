import { AbstractDatabase } from './abstract.database';
import { Database } from './database';

export class MySQLDatabase extends AbstractDatabase {
  /**
   * Constructs a new instance of the MySQLDatabase class.
   *
   * @param host - The hostname of the MySQL server.
   * @param user - The username for authentication.
   * @param password - The password for authentication.
   * @param database - The name of the database to connect to.
   * @param port - The port number on which the MySQL server is running.
   */
  constructor(
    protected host: string,
    protected user: string,
    protected password: string,
    protected database: string,
    protected port: number,
  ) {
    super(Database.MYSQL, host, user, password, database, port);
  }
}
