import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';
import { throwError } from '../lib/utils/throw-error';
import { validateDirectory } from '../lib/utils/validade-directory';

export class NewCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('new')
      .alias('n')
      .description('Generate Hedhog project.')
      .argument('<string>', 'project name')
      .option(
        '--directory <directory>',
        'Specify the destination directory',
        '.',
      )
      .option('-g, --skip-git', 'Skip git repository initialization.', false)
      .option('-s, --skip-install', 'Skip package installation.', false)
      .option(
        '-P, --package-manager [packageManager]',
        'Specify package manager.',
        'npm',
      )
      .option(
        '-d, --database [database]',
        'Specify database postgres or mysql.',
      )
      .option('-h, --dbhost [host]', 'Specify database host.')
      .option('-p, --dbport [port]', 'Specify database port.')
      .option('-u, --dbuser [user]', 'Specify database user.')
      .option('-w, --dbpassword [password]', 'Specify database password.')
      .option('-n, --dbname [database]', 'Specify database name.')
      .option(
        '-f, --force',
        'Force project creation if directory exists.',
        false,
      )
      .option(
        '-c, --docker-compose',
        'Create a docker-compose file if connection failed.',
        false,
      )
      .option('--data-volume', 'Database volume path.', './data')
      .action(async (name, command) => {
        try {
          if (!name) {
            throw new Error('Name is required');
          }

          if (!validateDirectory(command.directory)) {
            throw new Error('Directory is not valid');
          }

          const options: Input[] = [];

          options.push({
            name: 'data-volume',
            value: command.dataVolume ?? './data',
          });
          options.push({ name: 'dbhost', value: command.dbhost ?? '' });
          options.push({ name: 'dbport', value: command.dbport ?? '' });
          options.push({ name: 'dbuser', value: command.dbuser ?? '' });
          options.push({ name: 'dbpassword', value: command.dbpassword ?? '' });
          options.push({ name: 'dbname', value: command.dbname ?? '' });
          options.push({ name: 'database', value: command.database ?? '' });
          options.push({ name: 'directory', value: command.directory });
          options.push({ name: 'skip-git', value: command.skipGit });
          options.push({ name: 'skip-install', value: command.skipInstall });
          options.push({ name: 'force', value: command.force });
          options.push({
            name: 'docker-compose',
            value: command.dockerCompose,
          });
          options.push({
            name: 'packageManager',
            value: command.packageManager,
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
