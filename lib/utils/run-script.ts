import chalk = require('chalk');
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../package-managers';

export async function runScript(
  scriptName: string,
  name: string,
  collect = false,
) {
  let packageManager: AbstractPackageManager;

  try {
    packageManager = await PackageManagerFactory.find();
    return packageManager.runScript(scriptName, name, collect);
  } catch (error) {
    if (error && error.message) {
      console.error(chalk.red(error.message));
    }
  }
}
