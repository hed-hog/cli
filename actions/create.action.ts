import chalk = require('chalk');
import * as fs from 'fs';
import * as path from 'path';
import * as ora from 'ora';
import { AbstractAction } from './abstract.action';
import { Input } from '../commands';
import { Runner, RunnerFactory } from '../lib/runners';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { mkdir, writeFile } from 'fs/promises';

export class CreateAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    const removeDefaultDeps =
      Boolean(options.find((i) => i.name === 'remove-default-deps')?.value) ??
      false;

    if (!libraryName.length) {
      console.log(chalk.red('You must tell a name for the module.'));
      process.exit(1);
    }

    if (/\s/.test(libraryName)) {
      console.log(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    const libraryPath = path.join(process.cwd(), 'libs', libraryName);
    await this.createDirectory(libraryName);
    this.createGitignore(libraryPath);
    this.createPackageJson(libraryPath, libraryName, removeDefaultDeps);
    this.createTsconfigProduction(libraryPath);
    this.installDependencies(libraryPath, options);
    await this.createMigrationDirectory(libraryPath);
    await this.createEmptyDTODirectory(libraryPath);

    console.log(chalk.green(`Library ${libraryName} created successfully!`));
  }

  private async createDirectory(libraryName: string) {
    const spinner = ora('Creating library directory').start();
    const runner = RunnerFactory.create(Runner.NPX);
    await runner?.run(`yes '' | npx @nestjs/cli g library ${libraryName}`);

    spinner.succeed();
  }

  private createGitignore(libraryPath: string) {
    const gitignoreContent = `
/dist
/node_modules
    `.trim();

    fs.writeFileSync(path.join(libraryPath, '.gitignore'), gitignoreContent);
  }

  private createPackageJson(
    libraryPath: string,
    libraryName: string,
    removeDefaultDeps: boolean,
  ) {
    const packageJsonContent = {
      name: `@hedhog/${libraryName}`,
      version: '0.0.0',
      private: false,
      main: 'dist/index.js',
      scripts: {
        build: 'tsc --project tsconfig.production.json && npm version patch',
        prod: 'npm run build && npm publish --access public',
      },
      keywords: [],
      author: '',
      license: 'MIT',
      description: '',
      devDependencies: {
        'ts-node': '^10.9.1',
        'typescript': '^5.1.3',
      },
    };

    if (!removeDefaultDeps) {
      const devDeps = ['@hedhog/auth', '@hedhog/pagination', '@hedhog/prisma'];

      for (const devDep of devDeps) {
        (packageJsonContent as any).peerDependencies[devDep] = 'latest';
        (packageJsonContent.devDependencies as any)[devDep] = 'latest';
      }
    }

    fs.writeFileSync(
      path.join(libraryPath, 'package.json'),
      JSON.stringify(packageJsonContent, null, 2),
    );
  }

  private createTsconfigProduction(libraryPath: string) {
    const tsconfigProductionContent = {
      compilerOptions: {
        experimentalDecorators: true,
        target: 'es2017',
        module: 'commonjs',
        lib: ['es2017', 'es7', 'es6'],
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        outDir: './dist',
        rootDir: './src',
        strict: true,
        noImplicitAny: false,
        strictNullChecks: false,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        emitDecoratorMetadata: true,
      },
      exclude: ['node_modules', 'dist'],
    };

    fs.writeFileSync(
      path.join(libraryPath, 'tsconfig.production.json'),
      JSON.stringify(tsconfigProductionContent, null, 2),
    );
  }

  async installDependencies(libraryPath: string, options: Input[]) {
    const inputPackageManager = options.find(
      (option) => option.name === 'packageManager',
    )!.value as string;

    let packageManager: AbstractPackageManager;

    try {
      packageManager = PackageManagerFactory.create(inputPackageManager);
      return packageManager.install(libraryPath, inputPackageManager);
    } catch (error) {
      if (error && error.message) {
        console.error(chalk.red(error.message));
      }
    }
  }

  async createMigrationDirectory(libraryPath: string) {
    const migrationPath = path.join(libraryPath, 'src', 'migrations');
    await mkdir(migrationPath);
    writeFile(
      path.join(migrationPath, 'index.ts'),
      `import { MigrationInterface, QueryRunner } from 'typeorm';
export class Migrate implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {}
  public async down(queryRunner: QueryRunner): Promise<void> {}
}`,
    );
  }

  async createEmptyDTODirectory(libraryPath: string) {
    await mkdir(path.join(libraryPath, 'src', 'dto'));
  }
}
