import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ResetCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('reset')
      .description(
        'Redefines the hedhog project by removing all additional dependencies and their migrations.',
      )
      .usage('<dependency> [options]')
      .action(async (dependency, command) => {
        const options: Input[] = [];
        const inputs: Input[] = [];

        this.action.handle(inputs, options);
      });
  }
}
