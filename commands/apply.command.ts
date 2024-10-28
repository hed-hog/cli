import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';
import { throwError } from '../lib/utils/throw-error';

export class ApplyCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('apply')
      .description(
        'Transform the Hedhog YAML file into inserts on database and init the new Hedhog library.',
      )
      .argument('<string>', 'library name')
      .action(async (name) => {
        try {
          if (!name) {
            throw new Error('Library name is required');
          }

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });
          await this.action.handle(inputs);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
