import chalk = require('chalk');
import { Input } from '../commands';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { debug } from '../lib/utils/debug';

export abstract class AbstractAction {
  protected debug = false;

  public abstract handle(
    inputs?: Input[],
    options?: Input[],
    extraFlags?: string[],
  ): Promise<{ packagesAdded: string[] } | void>;

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
