import chalk = require('chalk');
import * as fs from 'fs';
import * as path from 'path';
import { AbstractAction } from './abstract.action';
import { Input } from '../commands';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { createModule } from '../lib/utils/create-module';
import {
  updateNestCliJson,
  updatePackageJson,
  updateTsconfigPaths,
} from '../lib/utils/update-files';
import { prettier } from '../lib/utils/formatting';
import { createYaml } from '../lib/utils/create-yaml';

export class CreateAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    const removeDefaultDeps =
      Boolean(options.find((i) => i.name === 'remove-default-deps')?.value) ??
      false;

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

    const libraryPath = path.join(process.cwd(), 'libs', libraryName);
    this.createGitignore(libraryPath);
    await this.createPackageJson(libraryPath, libraryName, removeDefaultDeps);
    await this.createTsconfigProduction(libraryPath);

    await createModule(libraryPath, libraryName);
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

    await this.installDependencies(libraryPath, options);

    console.info(chalk.green(`Library ${libraryName} created successfully!`));
  }

  private createGitignore(libraryPath: string) {
    const gitignoreContent = `
/dist
/node_modules
    `.trim();

    if (!fs.existsSync(libraryPath)) {
      fs.mkdirSync(libraryPath, { recursive: true });
    }

    fs.writeFileSync(path.join(libraryPath, '.gitignore'), gitignoreContent);
  }

  private async createPackageJson(
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
        clean: 'rimraf ./dist',
        prebuild: 'npm run clean',
        build: 'tsc --project tsconfig.production.json && npm version patch',
        prod: 'npm run build && npm publish --access public',
      },
      files: [
        'dist/**/*',
        'src/entities/**/*.ts',
        'src/migrations/**/*.ts',
        'src/**/*.ejs',
        'hedhog.yaml',
      ],
      keywords: [],
      author: '',
      license: 'MIT',
      description: '',
      devDependencies: {
        'ts-node': '^10.9.1',
        'typescript': '^5.1.3',
      },
      peerDependencies: {},
    };

    if (!removeDefaultDeps) {
      const devDeps = ['@hedhog/admin', '@hedhog/pagination', '@hedhog/prisma'];

      for (const devDep of devDeps) {
        (packageJsonContent as any).peerDependencies[devDep] = 'latest';
        (packageJsonContent.devDependencies as any)[devDep] = 'latest';
      }
    }

    const packageFilePath = path.join(libraryPath, 'package.json');
    fs.writeFileSync(
      packageFilePath,
      JSON.stringify(packageJsonContent, null, 2),
    );

    await prettier(packageFilePath);
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
      exclude: ['node_modules', 'dist'],
    };

    const tsConfigFilePath = path.join(libraryPath, 'tsconfig.production.json');

    fs.writeFileSync(
      tsConfigFilePath,
      JSON.stringify(tsconfigProductionContent, null, 2),
    );

    await prettier(tsConfigFilePath);
  }

  private async installDependencies(libraryPath: string, options: Input[]) {
    const inputPackageManager = options.find(
      (option) => option.name === 'packageManager',
    )!.value as string;

    const packageManager: AbstractPackageManager =
      PackageManagerFactory.create(inputPackageManager);

    try {
      console.info(chalk.blue('Installing production dependencies...'));
      const dependencies = [
        '@hedhog/admin',
        '@hedhog/pagination',
        '@hedhog/prisma',
        'ts-node',
        'typescript',
      ];

      const currentDir = process.cwd();
      process.chdir(libraryPath);
      await packageManager.addProduction(dependencies, 'latest');
      process.chdir(currentDir);

      console.info(chalk.green('Dependencies installed successfully.'));
    } catch (error) {
      console.info(chalk.red('Error installing dependencies:', error));
      process.exit(1);
    }
  }

  private async createIndexFile(libraryPath: string, libraryName: string) {
    const srcPath = path.join(libraryPath, 'src');

    if (!fs.existsSync(srcPath)) {
      fs.mkdirSync(srcPath, { recursive: true });
    }

    const indexContent = `
  export * from './${libraryName}.module';
    `.trim();

    const indexFilePath = path.join(srcPath, 'index.ts');
    fs.writeFileSync(indexFilePath, indexContent);
    await prettier(indexFilePath);
  }
}
