import chalk = require('chalk');
import path = require('path');
import * as fs from 'fs';
import { getRootPath } from './get-root-path';

export async function updateNestCliJson(libraryName: string) {
  const rootPath = await getRootPath();
  const nestCliPath = path.join(rootPath, 'lib', 'nest-cli.json');
  const cliBackendPath = path.join(rootPath, 'backend', 'nest-cli.json');

  try {
    const nestCliExists = fs.existsSync(nestCliPath);
    if (!nestCliExists) {
      if (fs.existsSync(cliBackendPath)) {
        fs.copyFileSync(cliBackendPath, nestCliPath);
      } else {
        console.info(chalk.red('Error: nest-cli.json not found!'));
        process.exit(1);
      }
    }

    const nestCliContent = JSON.parse(fs.readFileSync(nestCliPath, 'utf-8'));
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

    await fs.promises.writeFile(
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
  const packageJsonPath = path.join(rootPath, 'lib', 'package.json');

  try {
    const packageJsonExists = fs.existsSync(packageJsonPath);
    if (!packageJsonExists) {
      if (fs.existsSync(path.join(rootPath, 'backend', 'package.json'))) {
        fs.copyFileSync(
          path.join(rootPath, 'backend', 'package.json'),
          packageJsonPath,
        );
      } else {
        console.info(chalk.red('Error: package.json not found!'));
        process.exit(1);
      }
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

    const newMappingKey = `^@hedhog/${libraryName.toKebabCase()}(|/.*)$`;
    const newMappingValue = `<rootDir>/libs/${libraryName.toKebabCase()}/src/$1`;
    packageJsonContent.jest.moduleNameMapper[newMappingKey] = newMappingValue;

    await fs.promises.writeFile(
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
  const packageJsonPath = path.join(
    rootPath,
    'lib',
    'libs',
    libraryName,
    'package.json',
  );

  try {
    const packageJsonExists = fs.existsSync(packageJsonPath);
    if (!packageJsonExists) {
      console.info(chalk.red('Error: package.json not found!'));
      return;
    }

    const packageJsonContent = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf-8'),
    );

    if (!packageJsonContent.peerDependencies) {
      packageJsonContent.peerDependencies = {};
    }

    dependencies.forEach((dependency) => {
      packageJsonContent.peerDependencies[dependency] = 'latest';
    });

    await fs.promises.writeFile(
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
  const tsconfigPath = path.join(rootPath, 'lib', 'tsconfig.json');

  try {
    const tsconfigExists = fs.existsSync(tsconfigPath);
    if (!tsconfigExists) {
      if (fs.existsSync(path.join(rootPath, 'backend', 'tsconfig.json'))) {
        fs.copyFileSync(
          path.join(rootPath, 'backend', 'tsconfig.json'),
          tsconfigPath,
        );
      } else {
        console.info(chalk.red('Error: tsconfig.json not found!'));
        process.exit(1);
      }
    }

    const tsconfigContent = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
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

    await fs.promises.writeFile(
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
