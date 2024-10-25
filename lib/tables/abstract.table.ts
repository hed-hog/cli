import EventEmitter = require('events');
import { AbstractDatabase } from '../databases';
import { TableColumn } from 'typeorm';

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

  async apply() {
    this.eventEmitter.emit('debug', 'Applying table', {
      name: this.name,
      data: this.data,
      columns: AbstractTable.getColumns(this.data),
      dependencies: AbstractTable.getDependencies(this.data),
    });

    const queryRunner = this.db.getDataSource().createQueryRunner();

    console.log({ queryRunner });
  }
}
