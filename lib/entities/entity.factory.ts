import { AbstractDatabase } from '../databases';
import { DataType } from '../types/data-type';
import { AbstractEntity } from './abstract.entity';

export class EntityFactory {
  public static create(db: AbstractDatabase, name: string, data: DataType[]) {
    switch (name) {
      default:
        return new AbstractEntity(db, name, data);
    }
  }
}
