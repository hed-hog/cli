import * as chalk from 'chalk';
import { readFile } from 'node:fs';
import { join } from 'node:path';
import * as ora from 'ora';
import { AbstractRunner } from '../runners/abstract.runner';
import { MESSAGES } from '../ui';
import { normalizeToKebabOrSnakeCase } from '../utils/formatting';
import { PackageManagerCommands } from './package-manager-commands';
import { ProjectDependency } from './project.dependency';

export abstract class AbstractPackageManager {
  constructor(protected runner: AbstractRunner) { }

  public async installGlobal(packageName: string) {
    const commandArguments = `${this.cli.install} -g ${packageName}`;
    await this.runner.run(commandArguments);
  }

  public async install(directory: string, packageManager: string) {
    const spinner = ora({
      spinner: {
        interval: 120,
        frames: ['▹▹▹▹▹', '▸▹▹▹▹', '▹▸▹▹▹', '▹▹▸▹▹', '▹▹▹▸▹', '▹▹▹▹▸'],
      },
      text: MESSAGES.PACKAGE_MANAGER_INSTALLATION_IN_PROGRESS,
    });
    spinner.start();
    try {
      const commandArgs = `${this.cli.install} ${this.cli.silentFlag} ${this.cli.legacyPeerDepsFlag}`;
      const collect = true;
      const normalizedDirectory = normalizeToKebabOrSnakeCase(directory);
      await this.runner.run(
        commandArgs,
        collect,
        join(process.cwd(), normalizedDirectory),
      );
      spinner.succeed();
      return packageManager;
    } catch {
      spinner.fail();
      const commandArgs = this.cli.install;
      const commandToRun = this.runner.rawFullCommand(commandArgs);
      console.error(
        chalk.red(
          MESSAGES.PACKAGE_MANAGER_INSTALLATION_FAILED(
            chalk.bold(commandToRun),
          ),
        ),
      );
    }
  }

  public async version(): Promise<string> {
    const commandArguments = '--version';
    const collect = true;
    return this.runner.run(commandArguments, collect) as Promise<string>;
  }

  public async addProduction(
    dependencies: string[],
    tag: string,
    cwd = process.cwd(),
  ): Promise<boolean> {
    const command: string = [
      this.cli.add,
      this.cli.saveFlag,
      this.cli.silentFlag,
      this.cli.legacyPeerDepsFlag,
    ]
      .filter((i) => i)
      .join(' ');

    const args = [];

    for (const dependency of dependencies) {
      args.push(`${dependency}@latest`);
    }

    const spinner = ora({
      spinner: {
        interval: 120,
        frames: ['▹▹▹▹▹', '▸▹▹▹▹', '▹▸▹▹▹', '▹▹▸▹▹', '▹▹▹▸▹', '▹▹▹▹▸'],
      },
      text: MESSAGES.PACKAGE_MANAGER_PRODUCTION_INSTALLATION_IN_PROGRESS,
    });
    spinner.start();
    try {
      await this.add(`${command} ${args.join(' ')}`, cwd);
      spinner.succeed();
      return true;
    } catch {
      spinner.fail();
      return false;
    }
  }

  public async addDevelopment(
    dependencies: string[],
    tag: string,
    cwd = process.cwd(),
  ) {
    const command = `${this.cli.add} ${this.cli.saveDevFlag}`;
    const args: string = dependencies
      .map((dependency) => `${dependency}@${tag}`)
      .join(' ');
    await this.add(`${command} ${args}`, cwd);
  }

  private async add(commandArguments: string, cwd = process.cwd()) {
    const collect = true;
    await this.runner.run(commandArguments, collect, cwd);
  }

  public async getProduction(): Promise<ProjectDependency[]> {
    const packageJsonContent = await this.readPackageJson();
    const packageJsonDependencies: any = packageJsonContent.dependencies;
    const dependencies = [];

    for (const [name, version] of Object.entries(packageJsonDependencies)) {
      dependencies.push({ name, version });
    }

    return dependencies as ProjectDependency[];
  }

  public async getDevelopment(): Promise<ProjectDependency[]> {
    const packageJsonContent = await this.readPackageJson();
    const packageJsonDevDependencies: any = packageJsonContent.devDependencies;
    const dependencies = [];

    for (const [name, version] of Object.entries(packageJsonDevDependencies)) {
      dependencies.push({ name, version });
    }

    return dependencies as ProjectDependency[];
  }

  private async readPackageJson(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      readFile(
        join(process.cwd(), 'package.json'),
        (error: NodeJS.ErrnoException | null, buffer: Buffer) => {
          if (error !== undefined && error !== null) {
            reject(error);
          } else {
            resolve(JSON.parse(buffer.toString()));
          }
        },
      );
    });
  }

  public async updateProduction(dependencies: string[]) {
    const commandArguments = `${this.cli.update} ${dependencies.join(' ')}`;
    await this.update(commandArguments);
  }

  public async updateDevelopment(dependencies: string[]) {
    const commandArguments = `${this.cli.update} ${dependencies.join(' ')}`;
    await this.update(commandArguments);
  }

  private async update(commandArguments: string) {
    const collect = true;
    await this.runner.run(commandArguments, collect);
  }

  public async upgradeProduction(dependencies: string[], tag: string) {
    await this.deleteProduction(dependencies);
    await this.addProduction(dependencies, tag);
  }

  public async upgradeDevelopment(dependencies: string[], tag: string) {
    await this.deleteDevelopment(dependencies);
    await this.addDevelopment(dependencies, tag);
  }

  public async deleteProduction(dependencies: string[]) {
    const command: string = [this.cli.remove, this.cli.saveFlag]
      .filter((i) => i)
      .join(' ');
    const args: string = dependencies.join(' ');
    await this.delete(`${command} ${args}`);
  }

  public async deleteDevelopment(dependencies: string[]) {
    const commandArguments = `${this.cli.remove} ${this.cli.saveDevFlag
      } ${dependencies.join(' ')}`;
    await this.delete(commandArguments);
  }

  public async delete(commandArguments: string) {
    const collect = true;
    await this.runner.run(commandArguments, collect);
  }

  public async runScript(
    scriptName: string,
    directory = process.cwd(),
    collect = false,
  ) {
    const commandArguments = `${this.cli.run} ${scriptName}`;
    return this.runner.run(commandArguments, collect, directory);
  }

  public abstract get name(): string;

  public abstract get cli(): PackageManagerCommands;
}
