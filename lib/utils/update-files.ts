import chalk = require('chalk');
import path = require('path');
import * as fs from 'fs';
import { prettier } from './formatting';
import { toKebabCase } from './convert-string-cases';
import { getRootPath } from './get-root-path';

export async function updateNestCliJson(libraryName: string) {
  const rootPath = await getRootPath();
  const nestCliPath = path.join(rootPath, 'lib', 'nest-cli.json');

  try {
    const nestCliExists = fs.existsSync(nestCliPath);
    if (!nestCliExists) {
      console.info(chalk.red('Error: nest-cli.json not found!'));
      process.exit(1);
    }

    const nestCliContent = JSON.parse(fs.readFileSync(nestCliPath, 'utf-8'));

    const projectPath = `libs/${toKebabCase(libraryName)}`;
    const newProject = {
      type: 'library',
      root: projectPath,
      entryFile: 'index',
      sourceRoot: `${projectPath}/src`,
      compilerOptions: {
        tsConfigPath: `${projectPath}/tsconfig.lib.json`,
      },
    };

    nestCliContent.projects[toKebabCase(libraryName)] = newProject;

    await fs.promises.writeFile(
      nestCliPath,
      JSON.stringify(nestCliContent, null, 2),
    );

    await prettier(nestCliPath);

    console.info(
      chalk.green(
        `Updated nest-cli.json with project: ${toKebabCase(libraryName)}`,
      ),
    );
  } catch (error) {
    console.error(
      chalk.red(`Failed to update nest-cli.json: ${error.message}`),
    );
    process.exit(1);
  }
}

export async function updatePackageJson(libraryName: string) {
  const rootPath = await getRootPath();
  const packageJsonPath = path.join(rootPath, 'lib', 'package.json');

  try {
    const packageJsonExists = fs.existsSync(packageJsonPath);
    if (!packageJsonExists) {
      console.info(chalk.red('Error: package.json not found!'));
      process.exit(1);
    }

    const packageJsonContent = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf-8'),
    );

    if (!packageJsonContent.jest) {
      packageJsonContent.jest = {};
    }
    if (!packageJsonContent.jest.moduleNameMapper) {
      packageJsonContent.jest.moduleNameMapper = {};
    }

    const newMappingKey = `^@hedhog/${toKebabCase(libraryName)}(|/.*)$`;
    const newMappingValue = `<rootDir>/libs/${toKebabCase(libraryName)}/src/$1`;
    packageJsonContent.jest.moduleNameMapper[newMappingKey] = newMappingValue;

    await fs.promises.writeFile(
      packageJsonPath,
      JSON.stringify(packageJsonContent, null, 2),
    );

    await prettier(packageJsonPath);

    console.info(
      chalk.green(
        `Updated package.json with moduleNameMapper for ${toKebabCase(libraryName)}`,
      ),
    );
  } catch (error) {
    console.error(chalk.red(`Failed to update package.json: ${error.message}`));
    process.exit(1);
  }
}

export async function updateTsconfigPaths(libraryName: string) {
  const rootPath = await getRootPath();
  const tsconfigPath = path.join(rootPath, 'lib', 'tsconfig.json');

  try {
    const tsconfigExists = fs.existsSync(tsconfigPath);
    if (!tsconfigExists) {
      console.info(chalk.red('Error: tsconfig.json not found!'));
      process.exit(1);
    }

    const tsconfigContent = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    if (!tsconfigContent.compilerOptions.paths) {
      tsconfigContent.compilerOptions.paths = {};
    }

    const newPathKey = `@hedhog/${toKebabCase(libraryName)}`;
    const newPathKeyWithWildcard = `@hedhog/${toKebabCase(libraryName)}/*`;
    const newPathValue = [`libs/${toKebabCase(libraryName)}/src`];
    const newPathValueWithWildcard = [`libs/${toKebabCase(libraryName)}/src/*`];

    tsconfigContent.compilerOptions.paths[newPathKey] = newPathValue;
    tsconfigContent.compilerOptions.paths[newPathKeyWithWildcard] =
      newPathValueWithWildcard;

    await fs.promises.writeFile(
      tsconfigPath,
      JSON.stringify(tsconfigContent, null, 2),
    );

    await prettier(tsconfigPath);

    console.info(
      chalk.green(
        `Updated tsconfig.json paths for ${toKebabCase(libraryName)}`,
      ),
    );
  } catch (error) {
    console.error(
      chalk.red(`Failed to update tsconfig.json: ${error.message}`),
    );
    process.exit(1);
  }
}
