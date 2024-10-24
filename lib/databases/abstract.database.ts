import { Client } from 'pg';
import { Database } from './database';
import { Connection } from 'mysql2/promise';
import chalk = require('chalk');

interface IQueryOption {
  returning?: string[] | string;
  primaryKeys?: string[] | string;
}

type RelationN2NResult = {
  tableNameIntermediate: string;
  columnNameOrigin: string;
  columnNameDestination: string;
  primaryKeyDestination: string;
};

export class AbstractDatabase {
  private client: Client | Connection | null = null;
  private foreignKeys: any = {};
  private primaryKeys: any = {};
  private columnNameFromRelation: any = {};

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

  private shouldHandleReturning(options?: IQueryOption): boolean {
    return options?.returning !== undefined;
  }

  private isReturningSingleField(options?: IQueryOption): boolean {
    return (
      options?.returning instanceof Array && options.returning.length === 1
    );
  }

  private isReturningIdWithoutPrimaryKeys(options?: IQueryOption): boolean {
    return options?.returning === 'id' && !options.primaryKeys;
  }

  private isMissingPrimaryKeys(options?: IQueryOption): boolean {
    return !options?.primaryKeys;
  }

  private hasPrimaryKeys(options?: IQueryOption): boolean {
    return typeof options?.primaryKeys === 'string';
  }

  private hasReturning(options?: IQueryOption): boolean {
    return typeof options?.returning === 'string';
  }

  public async query(query: string, values?: any[], options?: IQueryOption) {
    await this.getClient();

    let result;

    if (options && this.shouldHandleReturning(options)) {
      if (this.isReturningSingleField(options)) {
        options.returning = (options.returning as any)[0];
      }
      if (this.isReturningIdWithoutPrimaryKeys(options)) {
        options.primaryKeys = options.returning;
      }

      if (this.isMissingPrimaryKeys(options)) {
        throw new Error('Primary key is required when using returning.');
      }

      if (this.hasPrimaryKeys(options)) {
        options.primaryKeys = [options.primaryKeys as string];
      }
      if (this.hasReturning(options)) {
        options.returning = [options.returning as string];
      }
    }

    switch (this.type) {
      case Database.POSTGRES:
        if (this.shouldHandleReturning(options)) {
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
        if (this.shouldHandleReturning(options)) {
          const resultArray = [
            {
              id: (result as any).insertId,
            },
          ];

          result = resultArray;

          const where = ((options?.primaryKeys as string[]) ?? [])
            .map((pk) => `${pk} = ?`)
            .join(' AND ');

          const selectReturningQuery = `SELECT ${(options?.returning as string[]).join(', ')} FROM ${this.getTableNameFromQuery(query)} WHERE ${where}`;
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

  public async getColumnNameFromRelation(
    tableNameOrigin: string,
    tableNameDestination: string,
  ) {
    if (
      this.columnNameFromRelation[`${tableNameOrigin}.${tableNameDestination}`]
    ) {
      return this.columnNameFromRelation[
        `${tableNameOrigin}.${tableNameDestination}`
      ];
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
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ? AND tc.table_name = ?;`,
          [tableNameOrigin, tableNameDestination],
        );

        if (!resultPg.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database.`,
          );
        }

        return (this.columnNameFromRelation[
          `${tableNameOrigin}.${tableNameDestination}`
        ] = resultPg[0].column_name);

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT
            TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ? AND TABLE_NAME = ?;`,
          [tableNameDestination, tableNameOrigin],
        );

        if (!resultMysql.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database.`,
          );
        }

        return (this.columnNameFromRelation[
          `${tableNameOrigin}.${tableNameDestination}`
        ] = resultMysql[0].COLUMN_NAME);

      default:
        throw new Error(`Unsupported database type: ${this.type}`);
    }
  }

  async getRelation1N(
    tableNameOrigin: string,
    tableNameDestination: string,
  ): Promise<string> {
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
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ? AND tc.table_name = ?;`,
          [tableNameOrigin, tableNameDestination],
        );

        if (!resultPg.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database.`,
          );
        }

        return resultPg[0].column_name;

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT
            TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ? AND TABLE_NAME = ?;`,
          [tableNameDestination, tableNameOrigin],
        );

        if (!resultMysql.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database.`,
          );
        }

        return resultMysql[0].COLUMN_NAME;
    }
  }

  async getRelationN2N(
    tableNameOrigin: string,
    tableNameDestination: string,
  ): Promise<RelationN2NResult> {
    let tableNameIntermediate = '';
    let columnNameOrigin = '';
    let columnNameDestination = '';
    let primaryKeyDestination = '';

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg1 = await this.query(
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
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ?;`,
          [tableNameOrigin],
        );

        for (const row of resultPg1) {
          const resultPg2 = await this.query(
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
            [row['table_name']],
          );

          for (const row2 of resultPg2) {
            if (row2['foreign_table_name'] === tableNameDestination) {
              tableNameIntermediate = row['table_name'];
              columnNameOrigin = row['column_name'];
              columnNameDestination = row2['column_name'];
              primaryKeyDestination = row2['foreign_column_name'];
            }
          }
        }

        return {
          tableNameIntermediate,
          columnNameOrigin,
          columnNameDestination,
          primaryKeyDestination,
        };

      case Database.MYSQL:
        const resultMysql1 = await this.query(
          `SELECT
            TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?;`,
          [tableNameOrigin],
        );

        for (const row of resultMysql1) {
          const resultMysql2 = await this.query(
            `SELECT
              TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
              FROM
              INFORMATION_SCHEMA.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?;`,
            [row['REFERENCED_TABLE_NAME']],
          );

          for (const row2 of resultMysql2) {
            if (row2['REFERENCED_TABLE_NAME'] === tableNameDestination) {
              tableNameIntermediate = row['TABLE_NAME'];
              columnNameOrigin = row['COLUMN_NAME'];
              columnNameDestination = row2['COLUMN_NAME'];
              primaryKeyDestination = row2['REFERENCED_COLUMN_NAME'];
            }
          }
        }

        return {
          tableNameIntermediate,
          columnNameOrigin,
          columnNameDestination,
          primaryKeyDestination,
        };

      default:
        throw new Error(`Unsupported database type: ${this.type}`);
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
