import { AbstractDatabase } from '../databases';
import { AbstractTable } from './abstract.table';

export class TableFactory {
  public static create(db: AbstractDatabase, name: string, data: any) {
    switch (name) {
      default:
        return new AbstractTable(db, name, data);
    }
  }
}
