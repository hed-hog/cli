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
  ) {}

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
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
        return {
          ...data,
          name: data.name ?? 'id',
          type: 'int',
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment',
          unsigned: true,
        };
      case 'fk':
        return {
          ...data,
          type: 'int',
          unsigned: true,
          isPrimary: data?.isPrimary ?? false,
          isNullable: data?.isNullable ?? false,
        };
      case 'created_at':
      case 'updated_at':
        return {
          ...data,
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          name: data.type,
        };
      case 'deleted_at':
        return {
          ...data,
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          name: data.type,
          isNullable: true,
        };
      case 'slug':
        return {
          ...data,
          name: data.name ?? 'slug',
          type: 'varchar',
          length: 255,
          unique: true,
        };
      default:
        return {
          type: 'varchar',
          ...data,
        };
    }
  }

  static getForeignKeys(data: any) {
    return data.columns
      .filter((column: any) => column.references && column.references.table)
      .map((column: any) => {
        const table = column.references.table;
        delete column.references.table;

        return {
          ...column.references,
          columnNames: [column.name],
          referencedColumnNames: [column.references.column],
          referencedTableName: table,
          onDelete: column.references.onDelete ?? 'NO ACTION',
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
    this.eventEmitter.emit('debug', 'created successfully');
  }
}
