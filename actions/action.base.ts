import chalk = require('chalk');
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { EMOJIS } from '../lib/ui';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { Input } from '../commands';
import { debug } from '../lib/utils/debug';

export class ActionBase {
  protected debug = false;
  private envVars: any = false;

  async parseEnvFile(envPath: string) {
    if (this.envVars) {
      return this.envVars;
    }

    if (existsSync(envPath)) {
      const envFile = await readFile(envPath, 'utf-8');
      const envLines = envFile.split('\n');

      const env: any = {};

      for (const line of envLines) {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key.trim()] = value.trim().replace(/['"\r]+/g, '');
        }
      }

      return (this.envVars = env);
    } else {
      console.error(chalk.red(`${EMOJIS.ERROR} File .env not found.`));
    }
  }

  showDebug(...args: any[]) {
    if (this.debug) {
      debug(...args);
    }
  }

  public async installDependencies(
    libraryPath: string,
    options: Input[],
    dependencies: string[],
  ) {
    const inputPackageManager =
      (options.find((option) => option.name === 'packageManager')
        ?.value as string) || 'npm';

    const packageManager: AbstractPackageManager =
      PackageManagerFactory.create(inputPackageManager);

    try {
      console.info(chalk.blue('Installing dependencies...'));
      const currentDir = process.cwd();
      process.chdir(libraryPath);
      await packageManager.addDevelopment(dependencies, 'latest');
      process.chdir(currentDir);

      console.info(chalk.green('Dependencies installed successfully.'));
    } catch (error) {
      console.info(chalk.red('Error installing dependencies:', error));
      process.exit(1);
    }
  }
}
