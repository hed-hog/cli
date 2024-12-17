import chalk = require('chalk');
import { copyFileSync, existsSync, promises, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRootPath } from './get-root-path';

export async function updateNestCliJson(libraryName: string) {
  const rootPath = await getRootPath();
  const nestCliPath = join(rootPath, 'lib', 'nest-cli.json');
  const cliBackendPath = join(rootPath, 'backend', 'nest-cli.json');

  try {
    const nestCliExists =
      existsSync(nestCliPath);
    if (!nestCliExists) {
      if (
        existsSync(cliBackendPath)) {

        copyFileSync(cliBackendPath, nestCliPath);
      } else {
        console.info(chalk.red('Error: nest-cli.json not found!'));
        process.exit(1);
      }
    }

    const nestCliContent = JSON.parse(
      readFileSync(nestCliPath, 'utf-8'));
    if (!nestCliContent.projects) {
      nestCliContent.projects = {};
    }
    const projectPath = `libs/${libraryName.toKebabCase()}`;
    const newProject = {
      type: 'library',
      root: projectPath,
      entryFile: 'index',
      sourceRoot: `${projectPath}/src`,
      compilerOptions: {
        tsConfigPath: `${projectPath}/tsconfig.lib.json`,
      },
    };

    nestCliContent.projects[libraryName.toKebabCase()] = newProject;

    await
      writeFile(
        nestCliPath,
        JSON.stringify(nestCliContent, null, 2),
      );

    console.info(
      chalk.green(
        `Updated nest-cli.json with project: ${libraryName.toKebabCase()}`,
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
  const packageJsonPath = join(rootPath, 'lib', 'package.json');

  try {
    const packageJsonExists =
      existsSync(packageJsonPath);
    if (!packageJsonExists) {
      if (
        existsSync(join(rootPath, 'backend', 'package.json'))) {

        copyFileSync(
          join(rootPath, 'backend', 'package.json'),
          packageJsonPath,
        );
      } else {
        console.info(chalk.red('Error: package.json not found!'));
        process.exit(1);
      }
    }

    const packageJsonContent = JSON.parse(

      readFileSync(packageJsonPath, 'utf-8'),
    );

    if (!packageJsonContent.jest) {
      packageJsonContent.jest = {};
    }
    if (!packageJsonContent.jest.moduleNameMapper) {
      packageJsonContent.jest.moduleNameMapper = {};
    }

    const newMappingKey = `^@hedhog/${libraryName.toKebabCase()}(|/.*)$`;
    const newMappingValue = `<rootDir>/libs/${libraryName.toKebabCase()}/src/$1`;
    packageJsonContent.jest.moduleNameMapper[newMappingKey] = newMappingValue;

    await
      promises.writeFile(
        packageJsonPath,
        JSON.stringify(packageJsonContent, null, 2),
      );

    console.info(
      chalk.green(
        `Updated package.json with moduleNameMapper for ${libraryName.toKebabCase()}`,
      ),
    );
  } catch (error) {
    console.error(chalk.red(`Failed to update package.json: ${error.message}`));
    process.exit(1);
  }
}

export async function addPackageJsonPeerDependencies(
  libraryName: string,
  dependencies: string[],
) {
  const rootPath = await getRootPath();
  const packageJsonPath = join(
    rootPath,
    'lib',
    'libs',
    libraryName,
    'package.json',
  );

  try {
    const packageJsonExists =
      existsSync(packageJsonPath);
    if (!packageJsonExists) {
      console.info(chalk.red('Error: package.json not found!'));
      return;
    }

    const packageJsonContent = JSON.parse(

      readFileSync(packageJsonPath, 'utf-8'),
    );

    if (!packageJsonContent.peerDependencies) {
      packageJsonContent.peerDependencies = {};
    }

    dependencies.forEach((dependency) => {
      packageJsonContent.peerDependencies[dependency] = 'latest';
    });

    await
      promises.writeFile(
        packageJsonPath,
        JSON.stringify(packageJsonContent, null, 2),
      );

    console.info(
      chalk.green(
        `Updated package.json with peerDependencies for ${dependencies.join(', ')}`,
      ),
    );
  } catch (error) {
    console.error(chalk.red(`Failed to update package.json: ${error.message}`));
    return;
  }
}

export async function updateTsconfigPaths(libraryName: string) {
  const rootPath = await getRootPath();
  const tsconfigPath = join(rootPath, 'lib', 'tsconfig.json');

  try {
    const tsconfigExists =
      existsSync(tsconfigPath);
    if (!tsconfigExists) {
      if (
        existsSync(join(rootPath, 'backend', 'tsconfig.json'))) {

        copyFileSync(
          join(rootPath, 'backend', 'tsconfig.json'),
          tsconfigPath,
        );
      } else {
        console.info(chalk.red('Error: tsconfig.json not found!'));
        process.exit(1);
      }
    }

    const tsconfigContent = JSON.parse(
      readFileSync(tsconfigPath, 'utf-8'));
    if (!tsconfigContent.compilerOptions.paths) {
      tsconfigContent.compilerOptions.paths = {};
    }

    const newPathKey = `@hedhog/${libraryName.toKebabCase()}`;
    const newPathKeyWithWildcard = `@hedhog/${libraryName.toKebabCase()}/*`;
    const newPathValue = [`libs/${libraryName.toKebabCase()}/src`];
    const newPathValueWithWildcard = [
      `libs/${libraryName.toKebabCase()}/src/*`,
    ];

    tsconfigContent.compilerOptions.paths[newPathKey] = newPathValue;
    tsconfigContent.compilerOptions.paths[newPathKeyWithWildcard] =
      newPathValueWithWildcard;

    await
      promises.writeFile(
        tsconfigPath,
        JSON.stringify(tsconfigContent, null, 2),
      );

    console.info(
      chalk.green(
        `Updated tsconfig.json paths for ${libraryName.toKebabCase()}`,
      ),
    );
  } catch (error) {
    console.error(
      chalk.red(`Failed to update tsconfig.json: ${error.message}`),
    );
    process.exit(1);
  }
}
