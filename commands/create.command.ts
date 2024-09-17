import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';
import { throwError } from '../lib/utils/throw-error';

export class CreateCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('create')
      .alias('c')
      .description('Create the basic structure for a new Hedhog library.')
      .argument('<string>', 'library name')
      .option(
        '-r, --remove-default-deps',
        'Remove default dependencies.',
        false,
      )
      .option(
        '-P, --package-manager [packageManager]',
        'Specify package manager.',
        'npm',
      )
      .option('-t, --table <string>', 'Specify the table name')
      .option(
        '-f, --fields <fields...>',
        'Fields for the migration in the format field:type:length or field:fk:table:column',
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

          if (command.table) {
            options.push({
              name: 'table',
              value: command.table,
            });
          }

          if (command.fields) {
            options.push({
              name: 'fields',
              value: command.fields,
            });
          }

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });
          await this.action.handle(inputs, options);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
