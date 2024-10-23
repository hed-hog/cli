import { AbstractEntity } from './abstract.entity';

export class MenusEntity extends AbstractEntity {
  constructor() {
    super();
  }

  async create() {
    super.create();
    console.log('menus entity create');
  }
}
