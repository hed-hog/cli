import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';

/**
 * Represents the command to start the application.
 *
 * @extends AbstractCommand
 */
export class StartCommand extends AbstractCommand {

  /**
   * Registers the 'start' command with the given program.
   *
   * @param {Command} program - The command program to which the 'start' command will be added.
   */
  public load(program: Command) {
    program
      .command('start')
      .description('Start the application')
      .action(async () => {
        await this.action.handle();
      });
  }
}
