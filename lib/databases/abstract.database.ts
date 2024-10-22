import { Client } from 'pg';
import { Database } from './database';
import { Connection } from 'mysql2/promise';

interface IQueryOption {
  returning?: string[] | string;
  primaryKey?: string;
}

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

  private getTableNameFromQuery(query: string): string | null {
    const match = query.match(/INSERT INTO\s+([`"]?[\w-]+[`"]?)/i);
    if (match && match[1]) {
      return match[1].replace(/[`"]/g, '');
    }

    return null;
  }

  public async query(query: string, values?: any[], options?: IQueryOption) {
    const client = await this.getClient();
    let result;

    if (options?.returning) {
      if (options.returning === 'id' && !options.primaryKey) {
        options.primaryKey = options.returning;
      }
      if (!options.primaryKey) {
        throw new Error('Primary key is required when using returning.');
      }
      if (typeof options.returning === 'string') {
        options.returning = [options.returning];
      }
    }

    switch (this.type) {
      case Database.POSTGRES:
        if (options?.returning) {
          query = `${query} RETURNING ${(options?.returning as string[]).join(', ')}`;
        }
        console.log(this.replacePlaceholders(query), values);
        result = await (client as Client).query(
          this.replacePlaceholders(query),
          values,
        );
        result = result.rows;
        break;

      case Database.MYSQL:
        result = await (client as unknown as Connection).query(query, values);
        result = result[0] as any[];
        if (options?.returning) {
          const resultArray = [
            {
              id: (result as any).insertId,
            },
          ];

          result = resultArray;

          const selectReturningQuery = `SELECT ${(options.returning as string[]).join(', ')} FROM ${this.getTableNameFromQuery(query)} WHERE ${options?.primaryKey} = ?`;
          const returningResult = await (client as unknown as Connection).query(
            selectReturningQuery,
            [resultArray[0].id],
          );
          result = returningResult;
        }
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
