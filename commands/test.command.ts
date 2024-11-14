import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';

export class TestCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('test')
      .description('Test command')
      .action(async () => {
        this.action.handle();
      });
  }
}
