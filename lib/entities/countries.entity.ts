import { AbstractDatabase } from '../databases';
import { DataType } from '../types/data-type';
import { AbstractEntity } from './abstract.entity';
import { Entity } from './entity';

export class CountriesEntity extends AbstractEntity {
  constructor(db: AbstractDatabase, name: Entity, data: DataType[]) {
    super(db, name, data);
  }
}
