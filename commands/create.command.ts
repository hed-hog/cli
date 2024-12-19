import { Command } from '@commander-js/extra-typings';
import { throwError } from '../lib/utils/throw-error';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class CreateCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('create')
      .alias('c')
      .description('Create the basic structure for a new Hedhog library.')
      .argument('<string>', 'library name')
      .option(
        '-f, --force',
        'Force the creation of the module even if the directory already has files.',
        false,
      )
      .option(
        '-r, --remove-default-deps',
        'Remove default dependencies.',
        false,
      )
      .option('--debug', 'Show debug information.', false)
      .option(
        '-P, --package-manager [packageManager]',
        'Specify package manager.',
        'npm',
      )
      .action(async (name, command) => {
        try {
          if (!name) {
            throw new Error('Library name is required');
          }

          const options: Input[] = [];
          options.push({
            name: 'remove-default-deps',
            value: command.removeDefaultDeps,
          });
          options.push({
            name: 'packageManager',
            value: command.packageManager,
          });
          options.push({
            name: 'force',
            value: command.force,
          });
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
