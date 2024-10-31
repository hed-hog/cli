import EventEmitter = require('events');
import { AbstractDatabase } from '../databases';
import { Table, TableColumn } from 'typeorm';
import { writeFile } from 'fs/promises';

export class AbstractTable {
  private eventEmitter = new EventEmitter();

  constructor(
    protected db: AbstractDatabase,
    protected name: string,
    protected data: any,
  ) {
    this.data = this.validadeData(data);
  }

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
  }

  private validadeData(data: any) {
    if (!data.columns || !Array.isArray(data.columns)) {
      throw new Error('Columns are required');
    }

    for (let i = 0; i < data.columns.length; i++) {
      if (
        data.columns[i].default &&
        typeof data.columns[i].default === 'string' &&
        data.columns[i].default[0] !== "'" &&
        data.columns[i].default[data.columns[i].default.length - 1] !== "'"
      ) {
        data.columns[i].default = `'${data.columns[i].default}'`;
      }
    }

    return data;
  }

  static getColumns(data: any) {
    if (Array.isArray(data.columns)) {
      return data.columns.map((column: any) =>
        AbstractTable.getColumnOptions(column),
      );
    } else {
      return [];
    }
  }

  static getDependencies(data: any) {
    const dependencies = [];
    for (const column of AbstractTable.getColumns(data)) {
      if (column.references && column.references.table) {
        dependencies.push(column.references.table);
      }
    }
    return [...new Set(dependencies)];
  }

  static getColumnOptions(data: any) {
    switch (data.type) {
      case 'pk':
        return Object.assign({}, data, {
          name: data.name ?? 'id',
          type: 'int',
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment',
          unsigned: true,
        });
      case 'fk':
        return Object.assign({}, data, {
          type: 'int',
          unsigned: true,
          isPrimary: data?.isPrimary ?? false,
          isNullable: data?.isNullable ?? false,
        });
      case 'created_at':
      case 'updated_at':
        return Object.assign({}, data, {
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          name: data.type,
        });

      case 'deleted_at':
        return Object.assign({}, data, {
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          name: data.type,
          isNullable: true,
        });
      case 'slug':
        return Object.assign({}, data, {
          name: data.name ?? 'slug',
          type: 'varchar',
          length: 255,
          isUnique: true,
        });
      case 'order':
        return Object.assign({}, data, {
          name: data.name ?? 'order',
          type: 'int',
          default: 0,
          unsigned: true,
          comment: 'order',
        });
      default:
        return Object.assign({ type: 'varchar' }, data);
    }
  }

  static getForeignKeys(data: any) {
    return data.columns
      .filter((column: any) => column.references && column.references.table)
      .map((columnData: any) => {
        let { table, column, ...rest } = columnData.references;

        if (!Array.isArray(column)) {
          column = [column];
        }

        return {
          ...rest,
          columnNames: [columnData.name],
          referencedColumnNames: column,
          referencedTableName: table,
          onDelete: columnData.references.onDelete ?? 'NO ACTION',
        };
      });
  }

  static getIndices(data: any) {
    return (data?.indices ?? []).map((i: any) => {
      const { columns, ...rest } = i;

      return {
        ...rest,
        columnNames: columns,
      };
    });
  }

  async apply() {
    this.eventEmitter.emit('debug', {
      name: this.name,
      data: this.data,
      columns: AbstractTable.getColumns(this.data),
      dependencies: AbstractTable.getDependencies(this.data),
      foreignKeys: AbstractTable.getForeignKeys(this.data),
      indices: AbstractTable.getIndices(this.data),
    });

    const dataSource = this.db.getDataSource();
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.createTable(
      new Table({
        name: this.name,
        columns: AbstractTable.getColumns(this.data),
        foreignKeys: AbstractTable.getForeignKeys(this.data),
        indices: AbstractTable.getIndices(this.data),
      }),
      Boolean(this.data.ifNotExists),
    );
    await dataSource.destroy();
    this.eventEmitter.emit('debug', 'created successfully');
  }
}
