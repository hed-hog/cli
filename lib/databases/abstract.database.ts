import { Client } from 'pg';
import { Database } from './database';
import { Connection } from 'mysql2/promise';

export class AbstractDatabase {
  constructor(
    protected type: Database,
    protected host: string,
    protected user: string,
    protected password: string,
    protected database: string,
    protected port: number,
  ) {}

  private replacePlaceholders(query: string): string {
    let index = 1;
    return query.replace(/\?/g, () => {
      return `$${index++}`;
    });
  }

  public async query(query: string, values?: any[]) {
    const client = await this.getClient();
    let result;

    switch (this.type) {
      case Database.POSTGRES:
        result = await (client as Client).query(
          this.replacePlaceholders(query),
          values,
        );
        result = result.rows;
        break;

      case Database.MYSQL:
        result = await (client as unknown as Connection).query(query, values);
        result = result[0] as any[];
        break;
    }

    await client.end();
    return result;
  }

  public async getClient() {
    switch (this.type) {
      case Database.POSTGRES:
        const { Client } = await import('pg');
        const client = new Client({
          host: this.host,
          user: this.user,
          password: this.password,
          database: this.database,
          port: this.port,
        });
        await client.connect();
        return client;

      case Database.MYSQL:
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host: this.host,
          user: this.user,
          password: this.password,
          database: this.database,
          port: this.port,
        });
        return connection;
    }
  }

  public async testDatabaseConnection(): Promise<boolean> {
    try {
      switch (this.type) {
        case Database.POSTGRES:
        case Database.MYSQL:
          await this.query('SELECT NOW()');
          break;
      }
    } catch (error) {
      return false;
    }
    return true;
  }
}
