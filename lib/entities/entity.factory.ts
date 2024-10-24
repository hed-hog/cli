import { Entity } from './entity';
import { DataType } from '../types/data-type';
import { AbstractEntity } from './abstract.entity';
import { AbstractDatabase } from '../databases';

export class EntityFactory {
  public static create(
    db: AbstractDatabase,
    name: Entity,
    data: DataType[],
    debug = false,
  ) {
    switch (name) {
      default:
        return new AbstractEntity(db, name, data, debug);
    }
  }
}
