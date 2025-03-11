import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ValidateCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('validate')
      .argument('<string>', 'module name')
      .option('--debug', 'Show debug information.', false)
      .description('Validade Hedhog files.')
      .usage('<module> [options]')
      .action(async (module, command) => {
        const options: Input[] = [];

        options.push({
          name: 'debug',
          value: command.debug,
        });
        const inputs: Input[] = [];
        inputs.push({ name: 'module', value: module });
        this.action.handle(inputs, options);
      });
  }
}
