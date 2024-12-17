import { Runner, RunnerFactory } from '../runners';
import { PnpmRunner } from '../runners/pnpm.runner';
import { AbstractPackageManager } from './abstract.package-manager';
import { PackageManager } from './package-manager';
import { PackageManagerCommands } from './package-manager-commands';

export class PnpmPackageManager extends AbstractPackageManager {

  /**
   * Initializes a new instance of the PnpmPackageManager class.
   * It uses the PnpmRunner to execute package management commands.
   */
  constructor() {
    super(RunnerFactory.create(Runner.PNPM) as PnpmRunner);
  }

  /**
   * Gets the name of the package manager in uppercase.
   *
   * @returns {string} The name of the package manager in uppercase format.
   */
  public get name(): string {
    return PackageManager.PNPM.toUpperCase();
  }


  /**
   * Provides the CLI commands specific to the PNPM package manager.
   * As of PNPM v5.3, all commands are shared with NPM v6.14.5. See: https://pnpm.js.org/en/pnpm-vs-npm
   *
   * @returns {PackageManagerCommands} An object containing the command strings for various package management actions.
   * - `install`: Command to install dependencies with strict peer dependencies disabled.
   * - `add`: Alias for the install command, also with strict peer dependencies disabled.
   * - `update`: Command to update dependencies.
   * - `remove`: Command to uninstall dependencies.
   * - `saveFlag`: Flag used to save installed packages as dependencies.
   * - `saveDevFlag`: Flag used to save installed packages as development dependencies.
   * - `silentFlag`: Flag to suppress output, setting the reporter to silent mode.
   * - `legacyPeerDepsFlag`: Flag to allow legacy peer dependencies.
   * - `run`: Command to execute scripts defined in the package.json.
   */
  get cli(): PackageManagerCommands {
    return {
      install: 'install --strict-peer-dependencies=false',
      add: 'install --strict-peer-dependencies=false',
      update: 'update',
      remove: 'uninstall',
      saveFlag: '--save',
      saveDevFlag: '--save-dev',
      silentFlag: '--reporter=silent',
      legacyPeerDepsFlag: '--legacy-peer-deps',
      run: 'run',
    };
  }
}
