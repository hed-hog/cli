import { AbstractDatabase } from '../databases';
import { DataType } from '../types/data-type';
import { AbstractEntity } from './abstract.entity';
import { Entity } from './entity';

export class MenusEntity extends AbstractEntity {
  constructor(db: AbstractDatabase, name: Entity, data: DataType[]) {
    super(db, name, data);
  }

  async create() {
    super.apply();
    console.log('menus entity create');
  }
}
