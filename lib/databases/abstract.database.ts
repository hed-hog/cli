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

  async getPrimaryKey(tableName: string): Promise<string> {
    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT a.attname
          FROM   pg_index i
          JOIN   pg_attribute a ON a.attrelid = i.indrelid
                              AND a.attnum = ANY(i.indkey)
          WHERE  i.indrelid = '${tableName}'::regclass
          AND    i.indisprimary;`,
        );
        return resultPg[0].attname;

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SHOW KEYS FROM ${tableName} WHERE Key_name = 'PRIMARY'`,
        );
        return resultMysql[0].Column;
    }
  }

  async getForeignKeys(tableName: string): Promise<string[]> {
    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT
            tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
          FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?;`,
          [tableName],
        );
        return resultPg.map((row: any) => row.column_name);

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_NAME = ? AND CONSTRAINT_NAME != 'PRIMARY'`,
          [tableName],
        );
        return resultMysql.map((row: any) => row.COLUMN_NAME);
    }
  }
}
