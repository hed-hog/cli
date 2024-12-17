import { Runner, RunnerFactory } from '../runners';
import { YarnRunner } from '../runners/yarn.runner';
import { AbstractPackageManager } from './abstract.package-manager';
import { PackageManager } from './package-manager';
import { PackageManagerCommands } from './package-manager-commands';

export class YarnPackageManager extends AbstractPackageManager {
  /**
   * Initializes a new instance of the YarnPackageManager class.
   * @constructor
   */
  constructor() {
    super(RunnerFactory.create(Runner.YARN) as YarnRunner);
  }


  /**
   * Gets the name of the package manager.
   * @returns The name of the package manager (YARN).
   */
  public get name() {
    return PackageManager.YARN.toUpperCase();
  }

  /**
   * Provides the CLI commands specific to the Yarn package manager.
   *
   * @returns {PackageManagerCommands} An object containing the command strings for various package management actions.
   * - `install`: Command to install dependencies.
   * - `add`: Command to add a package to the dependencies.
   * - `update`: Command to upgrade dependencies.
   * - `remove`: Command to remove a package from the dependencies.
   * - `saveFlag`: Flag used to save installed packages as dependencies (empty for Yarn).
   * - `saveDevFlag`: Flag used to save installed packages as development dependencies.
   * - `silentFlag`: Flag to suppress output, setting the reporter to silent mode.
   * - `legacyPeerDepsFlag`: Flag to allow legacy peer dependencies.
   * - `run`: Command to execute scripts defined in the package.json.
   */
  get cli(): PackageManagerCommands {
    return {
      install: 'install',
      add: 'add',
      update: 'upgrade',
      remove: 'remove',
      saveFlag: '',
      saveDevFlag: '-D',
      silentFlag: '--silent',
      legacyPeerDepsFlag: '--legacy-peer-deps',
      run: 'run',
    };
  }
}
