import { Runner, RunnerFactory } from '../runners';
import { NpmRunner } from '../runners/npm.runner';
import { AbstractPackageManager } from './abstract.package-manager';
import { PackageManager } from './package-manager';
import { PackageManagerCommands } from './package-manager-commands';

export class NpmPackageManager extends AbstractPackageManager {
  /**
   * Initializes a new instance of the NpmPackageManager class.
   * @constructor
   */
  constructor() {
    super(RunnerFactory.create(Runner.NPM) as NpmRunner);
  }

  /**
   * Gets the name of the package manager.
   * @returns The name of the package manager.
   */
  public get name() {
    return PackageManager.NPM.toUpperCase();
  }

  /**
   * Gets the CLI commands for the package manager.
   * @returns The CLI commands for the package manager.
   */
  get cli(): PackageManagerCommands {
    return {
      install: 'install',
      add: 'install',
      update: 'update',
      remove: 'uninstall',
      saveFlag: '--save',
      saveDevFlag: '--save-dev',
      silentFlag: '--silent',
      legacyPeerDepsFlag: '--legacy-peer-deps',
      run: 'run',
    };
  }
}
