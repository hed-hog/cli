import chalk = require('chalk');
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../package-managers';

/**
 * Runs the given script with the given package manager.
 * If the script is not found, tries to find the package manager
 * and run the script.
 *
 * @param scriptName The name of the script to run.
 * @param directory The directory to run the script in.
 * @param collect If true, collect the output of the script
 * into a string and return it.
 * @returns The output of the script or null if the script is not found.
  */
export async function runScript(
  scriptName: string,
  directory: string,
  collect = false,
): Promise<string | null | undefined> {
  let packageManager: AbstractPackageManager;

  try {
    packageManager = await PackageManagerFactory.find();
    return packageManager.runScript(scriptName, directory, collect);
  } catch (error) {
    if (error && error.message) {
      console.error(chalk.red(error.message));
    }
  }
}
