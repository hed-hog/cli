import * as chalk from 'chalk';
import { Entity } from './entity';
import { MenusEntity } from './menus.entity';

export class EntityFactory {
  public static create(type: Entity) {
    switch (type) {
      case Entity.menus:
        return new MenusEntity();

      default:
        throw new Error(chalk.red(`Entity ${type} not found`));
    }
  }
}
