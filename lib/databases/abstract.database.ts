import { Client } from 'pg';
import { Database } from './database';
import { Connection } from 'mysql2/promise';
import chalk = require('chalk');

interface IQueryOption {
  returning?: string[] | string;
  primaryKeys?: string[] | string;
}

export class AbstractDatabase {
  private client: Client | Connection | null = null;
  private foreignKeys: any = {};
  private primaryKeys: any = {};

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

  getTableNameFromQuery(query: string): string | null {
    const match = query.match(/INSERT INTO\s+([`"]?[\w-]+[`"]?)/i);
    if (match && match[1]) {
      return match[1].replace(/[`"]/g, '');
    }

    return null;
  }

  async getTableNameFromForeignKey(
    tableName: string,
    foreignKey: string,
  ): Promise<string> {
    if (this.foreignKeys[`${tableName}.${foreignKey}`]) {
      return this.foreignKeys[`${tableName}.${foreignKey}`];
    }

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
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ? AND kcu.column_name = ?;`,
          [tableName, foreignKey],
        );

        if (resultPg.length === 0) {
          throw new Error(
            `Foreign key ${tableName}.${foreignKey} not found in database.`,
          );
        }

        return (this.foreignKeys[`${tableName}.${foreignKey}`] =
          resultPg[0].foreign_table_name);

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT REFERENCED_TABLE_NAME as foreign_table_name
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [tableName, foreignKey],
        );

        if (resultMysql.length === 0) {
          throw new Error(
            `Foreign key ${tableName}.${foreignKey} not found in database.`,
          );
        }

        return (this.foreignKeys[`${tableName}.${foreignKey}`] =
          resultMysql[0].foreign_table_name);
    }
  }

  public async query(query: string, values?: any[], options?: IQueryOption) {
    await this.getClient();

    let result;

    if (options?.returning) {
      if (
        options.returning &&
        options.returning instanceof Array &&
        options.returning.length === 1
      ) {
        options.returning = options.returning[0];
      }
      if (options.returning === 'id' && !options.primaryKeys) {
        options.primaryKeys = options.returning;
      }

      if (!options.primaryKeys) {
        throw new Error('Primary key is required when using returning.');
      }

      if (typeof options.primaryKeys === 'string') {
        options.primaryKeys = [options.primaryKeys];
      }
      if (typeof options.returning === 'string') {
        options.returning = [options.returning];
      }
    }

    switch (this.type) {
      case Database.POSTGRES:
        if (options?.returning !== undefined) {
          query = `${query} RETURNING ${(options?.returning as string[]).join(', ')}`;
        }

        result = await (this.client as Client).query(
          this.replacePlaceholders(query),
          values,
        );

        result = result.rows;
        break;

      case Database.MYSQL:
        result = await (this.client as unknown as Connection).query(
          query,
          values,
        );
        result = result[0] as any[];
        if (options?.returning) {
          const resultArray = [
            {
              id: (result as any).insertId,
            },
          ];

          result = resultArray;

          const where = ((options?.primaryKeys as string[]) ?? [])
            .map((pk) => `${pk} = ?`)
            .join(' AND ');

          const selectReturningQuery = `SELECT ${(options.returning as string[]).join(', ')} FROM ${this.getTableNameFromQuery(query)} WHERE ${where}`;
          const returningResult = await (
            this.client as unknown as Connection
          ).query(selectReturningQuery, [resultArray[0].id]);
          result = returningResult;
        }
        break;
    }

    await this.client?.end();
    return result;
  }

  public async getClient() {
    switch (this.type) {
      case Database.POSTGRES:
        const { Client } = await import('pg');
        this.client = new Client({
          host: this.host,
          user: this.user,
          password: this.password,
          database: this.database,
          port: this.port,
        });
        await this.client.connect();
        return this.client;

      case Database.MYSQL:
        const mysql = await import('mysql2/promise');
        this.client = await mysql.createConnection({
          host: this.host,
          user: this.user,
          password: this.password,
          database: this.database,
          port: this.port,
        });
        return this.client;
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

  public async getPrimaryKeys(tableName: string): Promise<string[]> {
    if (this.primaryKeys[tableName]) {
      return this.primaryKeys[tableName];
    }

    let primaryKeys: string[] = [];

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          WHERE constraint_type = 'PRIMARY KEY'
          AND tc.table_name = ?`,
          [tableName],
        );

        primaryKeys = resultPg.map((row: any) => row.column_name);

        if (primaryKeys.length > 0) {
          this.primaryKeys[tableName] = primaryKeys;
        }

        return primaryKeys;

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'`,
          [tableName],
        );

        primaryKeys = resultMysql.map((row: any) => row.column_name);

        if (primaryKeys.length > 0) {
          this.primaryKeys[tableName] = primaryKeys;
        }

        return primaryKeys;
    }
  }

  public async getForeignKeys(tableName: string): Promise<string[]> {
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

  public static parseQueryValue(value: any) {
    switch (typeof value) {
      case 'number':
      case 'boolean':
        return value;

      default:
        return `'${value}'`;
    }
  }

  public static objectToWhereClause(obj: any) {
    let whereClause = '';

    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        whereClause += `${key} ${obj[key].operator} ${AbstractDatabase.parseQueryValue(obj[key].value)}`;
      } else {
        whereClause += `${key} = ${AbstractDatabase.parseQueryValue(obj[key])}`;
      }
    }

    return whereClause;
  }
}
