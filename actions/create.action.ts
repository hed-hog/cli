import chalk = require('chalk');
import * as inquirer from 'inquirer';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Input } from '../commands';
import { FileCreator } from '../lib/classes/FileCreator';
import { TableApply } from '../lib/classes/TableApply';
import { createYaml } from '../lib/utils/create-yaml';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';
import { getRootPath } from '../lib/utils/get-root-path';
import {
  updateNestCliJson,
  updatePackageJson,
  updateTsconfigPaths,
} from '../lib/utils/update-files';
import { AbstractAction } from './abstract.action';

export class CreateAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    const removeDefaultDeps =
      Boolean(options.find((i) => i.name === 'remove-default-deps')?.value) ??
      false;
    const force =
      Boolean(options.find((i) => i.name === 'force')?.value) ?? false;

    if (!libraryName.length) {
      console.error(chalk.red('You must tell a name for the module.'));
      process.exit(1);
    }

    if (/\s/.test(libraryName)) {
      console.error(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    const rootPath = await getRootPath();

    const libraryPath = join(
      rootPath,
      'lib',
      'libs',
      libraryName.toKebabCase(),
    );

    this.showDebug({
      libraryPath,
      libraryName,
      removeDefaultDeps,
      force,
      rootPath,
    });

    await this.checkLibraryExistence(libraryPath, force);
    this.createGitignore(libraryPath);
    await this.createPackageJson(libraryPath, libraryName, removeDefaultDeps);
    await this.createTsconfigProduction(libraryPath);

    new FileCreator(
      libraryPath,
      libraryName,
      { name: libraryName } as TableApply,
      'module',
    ).createFile();
    await createYaml(libraryPath);

    console.info(
      chalk.green(
        `Created YAML example file on the project root. After the installation, edit the hedhog.yaml file according to your need.`,
      ),
    );

    await this.createIndexFile(libraryPath, libraryName);

    await updateNestCliJson(libraryName);
    await updatePackageJson(libraryName);
    await updateTsconfigPaths(libraryName);

    await this.installDependencies(libraryPath, options, [
      '@hedhog/admin',
      '@hedhog/pagination',
      '@hedhog/prisma',
      '@nestjs/mapped-types',
    ]);

    console.info(chalk.green(`Library ${libraryName} created successfully!`));
  }

  private async checkLibraryExistence(libraryPath: string, force: boolean) {
    if (existsSync(libraryPath)) {
      if (force) {
        console.warn(
          chalk.yellow(
            `Warning: Library path ${libraryPath} already exists. Overwriting due to force option.`,
          ),
        );
      } else {
        const answer = await inquirer.createPromptModule({
          output: process.stderr,
          input: process.stdin,
        })({
          type: 'confirm',
          name: 'exists',
          message: `Library path ${libraryPath} already exists. Do you want to overwrite it?`,
        });

        if (!answer.exists) {
          console.info(chalk.red('Aborting library creation...'));
          process.exit(0);
        } else {
          console.info('Overwriting library path...');
        }
      }
    }
  }

  private async createGitignore(libraryPath: string) {
    const gitignoreContent = `
/dist
/node_modules
    `.trim();

    if (!existsSync(libraryPath)) {
      await mkdir(libraryPath, { recursive: true });
    }

    await writeFile(join(libraryPath, '.gitignore'), gitignoreContent);
  }

  private async createPackageJson(
    libraryPath: string,
    libraryName: string,
    removeDefaultDeps: boolean,
  ) {
    const packageJsonContent = {
      name: `@hedhog/${libraryName.toKebabCase()}`,
      version: '0.0.0',
      private: false,
      main: 'dist/index.js',
      scripts: {
        clean: 'rimraf ./dist',
        prebuild: 'npm run clean',
        build: 'tsc --project tsconfig.production.json && npm version patch',
        prod: 'npm run build && npm publish --access public',
      },
      files: [
        'dist/**/*',
        'frontend/**/*',
        'src/entities/**/*.ts',
        'src/migrations/**/*.ts',
        'src/**/*.ejs',
        'hedhog.yaml',
      ],
      keywords: [],
      author: '',
      license: 'MIT',
      description: '',
      peerDependencies: {},
    };

    if (!removeDefaultDeps) {
      const devDeps = ['@hedhog/admin', '@hedhog/pagination', '@hedhog/prisma'];

      for (const devDep of devDeps) {
        (packageJsonContent as any).peerDependencies[devDep] = 'latest';
      }
    }

    const packageFilePath = join(libraryPath, 'package.json');
    if (!existsSync(libraryPath)) {
      await mkdir(libraryPath, { recursive: true });
    }
    await writeFile(
      packageFilePath,
      JSON.stringify(packageJsonContent, null, 2),
    );
  }

  private async createTsconfigProduction(libraryPath: string) {
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
      exclude: ['node_modules', 'dist', 'frontend'],
    };

    const tsConfigFilePath = join(libraryPath, 'tsconfig.production.json');

    writeFileSync(
      tsConfigFilePath,
      JSON.stringify(tsconfigProductionContent, null, 2),
    );
  }

  private async createIndexFile(libraryPath: string, libraryName: string) {
    const srcPath = join(libraryPath, 'src');

    if (!existsSync(srcPath)) {
      mkdirSync(srcPath, { recursive: true });
    }

    const indexContent = `
  export * from './${libraryName.toKebabCase()}.module';
    `.trim();

    const indexFilePath = join(srcPath, 'index.ts');
    writeFileSync(
      indexFilePath,
      await formatWithPrettier(indexContent, {
        parser: 'typescript',
      }),
    );
  }
}
