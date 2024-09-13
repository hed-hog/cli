import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';
import { throwError } from '../lib/utils/throw-error';
import { validateDirectory } from '../lib/utils/validade-directory';

export class CreateCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('create')
      .alias('c')
      .description('Create the basic structure for a new Hedhog library.')
      .argument('<string>', 'library name')
      .option(
        '--directory <directory>',
        'Specify the destination directory',
        '.',
      )
      .option('-s, --skip-install', 'Skip package installation.', false)
      .action(async (name, command) => {
        try {
          if (!name) {
            throw new Error('Library name is required');
          }

          if (!validateDirectory(command.directory)) {
            throw new Error('Directory is not valid');
          }

          const options: Input[] = [];
          options.push({ name: 'directory', value: command.directory });
          options.push({ name: 'skip-install', value: command.skipInstall });

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });
          await this.action.handle(inputs, options);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
