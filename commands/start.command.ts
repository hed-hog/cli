import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';

export class StartCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('start')
      .description('Start the application')
      .action(async () => {
        await this.action.handle();
      });
  }
}
