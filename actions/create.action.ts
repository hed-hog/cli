import chalk = require('chalk');
import * as fs from 'fs';
import * as path from 'path';
import * as ora from 'ora';
import { exec } from 'child_process';
import { AbstractAction } from './abstract.action';
import { Input } from '../commands';

export class CreateAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value || 'default-library',
    ).toLowerCase();

    if (/\s/.test(libraryName)) {
      console.log(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    const libraryPath = path.join(process.cwd(), libraryName);
    this.createDirectory(libraryPath);
    this.createGitignore(libraryPath);
    this.createPackageJson(libraryPath, libraryName);
    this.createTsconfigLib(libraryPath, libraryName);
    this.createTsconfigProduction(libraryPath);
    this.createSrcFiles(libraryPath, libraryName);
    this.installDependencies(libraryPath);

    console.log(chalk.green(`Library ${libraryName} created successfully!`));
  }

  private createDirectory(libraryPath: string) {
    const spinner = ora('Creating library directory').start();
    if (!fs.existsSync(libraryPath)) {
      fs.mkdirSync(libraryPath, { recursive: true });
      spinner.succeed();
    } else {
      spinner.fail('Directory already exists.');
      process.exit(1);
    }
  }

  private createGitignore(libraryPath: string) {
    const gitignoreContent = `
/dist
/node_modules
    `.trim();

    fs.writeFileSync(path.join(libraryPath, '.gitignore'), gitignoreContent);
  }

  private createPackageJson(libraryPath: string, libraryName: string) {
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
      peerDependencies: {
        '@hedhog/auth': 'latest',
        '@hedhog/pagination': 'latest',
        '@hedhog/prisma': 'latest',
      },
      devDependencies: {
        '@hedhog/auth': 'latest',
        '@hedhog/pagination': 'latest',
        '@hedhog/prisma': 'latest',
        'ts-node': '^10.9.1',
        'typescript': '^5.1.3',
      },
    };

    fs.writeFileSync(
      path.join(libraryPath, 'package.json'),
      JSON.stringify(packageJsonContent, null, 2),
    );
  }

  private createTsconfigLib(libraryPath: string, libraryName: string) {
    const tsconfigLibContent = {
      extends: '../../tsconfig.json',
      compilerOptions: {
        declaration: true,
        outDir: `../../dist/libs/${libraryName}`,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', 'test', '**/*spec.ts'],
    };

    fs.writeFileSync(
      path.join(libraryPath, 'tsconfig.lib.json'),
      JSON.stringify(tsconfigLibContent, null, 2),
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

  private createSrcFiles(libraryPath: string, libraryName: string) {
    const srcPath = path.join(libraryPath, 'src');
    if (!fs.existsSync(srcPath)) {
      fs.mkdirSync(srcPath);
    } else {
      chalk.red('Error: Directory /src already exists.');
      process.exit(1);
    }

    const controllerContent = `
import { Controller, Get } from '@nestjs/common';

@Controller('${libraryName}')
export class ${this.capitalize(libraryName)}Controller {
  @Get()
  findAll() {
    return 'This action returns all ${libraryName}';
  }
}
    `.trim();
    fs.writeFileSync(
      path.join(srcPath, `${libraryName}.controller.ts`),
      controllerContent,
    );

    const serviceContent = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class ${this.capitalize(libraryName)}Service {
  findAll() {
    return 'This action returns all ${libraryName}';
  }
}
    `.trim();
    fs.writeFileSync(
      path.join(srcPath, `${libraryName}.service.ts`),
      serviceContent,
    );

    const moduleContent = `
import { Module } from '@nestjs/common';
import { ${this.capitalize(libraryName)}Controller } from './${libraryName}.controller';
import { ${this.capitalize(libraryName)}Service } from './${libraryName}.service';

@Module({
  controllers: [${this.capitalize(libraryName)}Controller],
  providers: [${this.capitalize(libraryName)}Service],
})
export class ${this.capitalize(libraryName)}Module {}
    `.trim();
    fs.writeFileSync(
      path.join(srcPath, `${libraryName}.module.ts`),
      moduleContent,
    );

    const indexContent = `
export * from './${libraryName}.controller';
export * from './${libraryName}.service';
export * from './${libraryName}.module';
    `.trim();
    fs.writeFileSync(path.join(srcPath, 'index.ts'), indexContent);
  }

  installDependencies(libraryPath: string) {
    console.log(chalk.blue(`\nInstalling dependencies in ${libraryPath}...`));

    exec('npm install', { cwd: libraryPath }, (error, stdout, stderr) => {
      if (error) {
        console.log(chalk.red(`Error during npm install: ${error.message}`));
        return;
      }
      if (stderr) {
        console.log(chalk.red(`npm install stderr: ${stderr}`));
      }
      console.log(chalk.green(`\nDependencies installed successfully!\n`));
      console.log(stdout);
    });
  }

  private capitalize(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
