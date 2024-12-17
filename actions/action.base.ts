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

/**
 * The base class for all actions in the hedhog CLI.
 * It provides common functionality for handling inputs, options, and extra flags.
 * @abstract
 */
export class ActionBase {
  protected debug = false;
  private envVars: any = false;

  /**
   * Reads the given .env file and parses it into a key-value object.
   * The object is also stored in the `envVars` property of this class.
   * @param envPath The path to the .env file.
   * @returns The parsed key-value object.
   */
  async parseEnvFile(envPath: string) {
    if (this.envVars) {
      return this.envVars;
    }

    if (existsSync(envPath)) {
      let envFile = await readFile(envPath, 'utf-8');
      const envLines = envFile.split('\n');

      const env: any = {};

      // First pass: parse the env file into key-value pairs
      for (const line of envLines) {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key.trim()] = value.trim().replace(/['"\r]+/g, '');
        }
      }

      // Second pass: replace variable references in the values
      for (const key in env) {
        env[key] = env[key].replace(
          /\${(.*?)}/g,
          (_: any, varName: string | number) => env[varName] || '',
        );
      }

      this.envVars = env;
      return env;
    } else {
      console.error(chalk.red(`${EMOJIS.ERROR} File .env not found.`));
    }
  }

  /**
   * Logs debug information to the console if debugging is enabled.
   * Utilizes the `debug` utility function to output the provided arguments.
   * @param args The arguments to be logged as debug information.
   */
  showDebug(...args: any[]) {
    if (this.debug) {
      debug(...args);
    }
  }

  /**
   * Installs the provided dependencies using the specified package manager.
   * Logs information messages when the installation starts and finishes.
   * If the installation fails, logs an error message and exits the process with code 1.
   * @param libraryPath The path to the library where the dependencies should be installed.
   * @param options The options for the install operation.
   * @param dependencies The dependencies to be installed.
   */
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
