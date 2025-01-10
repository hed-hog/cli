import { Command } from '@commander-js/extra-typings';
import { throwError } from '../lib/utils/throw-error';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ApplyCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('apply')
      .description(
        'Transform the Hedhog YAML file into inserts on database and init the new Hedhog library.',
      )
      .option('--debug', 'Show debug information.', false)
      .argument('<string>', 'backend or admin')
      .action(async (name, command) => {
        try {
          if (!name || (name !== 'backend' && name !== 'admin')) {
            throw new Error(
              'Environment type is required and must be a valid one. (backend/admin)',
            );
          }

          const options: Input[] = [];
          options.push({
            name: 'debug',
            value: command.debug,
          });

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });
          await this.action.handle(inputs, options);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
