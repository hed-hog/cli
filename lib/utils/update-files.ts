import chalk = require('chalk');
import path = require('path');
import * as fs from 'fs';

export async function updateNestCliJson(libraryName: string) {
  const nestCliPath = path.join(process.cwd(), 'nest-cli.json');

  try {
    const nestCliExists = fs.existsSync(nestCliPath);
    if (!nestCliExists) {
      console.log(chalk.red('Error: nest-cli.json not found!'));
      process.exit(1);
    }

    const nestCliContent = JSON.parse(fs.readFileSync(nestCliPath, 'utf-8'));

    const projectPath = `libs/${libraryName}`;
    const newProject = {
      type: 'library',
      root: projectPath,
      entryFile: 'index',
      sourceRoot: `${projectPath}/src`,
      compilerOptions: {
        tsConfigPath: `${projectPath}/tsconfig.lib.json`,
      },
    };

    nestCliContent.projects[libraryName] = newProject;

    await fs.promises.writeFile(
      nestCliPath,
      JSON.stringify(nestCliContent, null, 2),
    );

    console.log(
      chalk.green(`Updated nest-cli.json with project: ${libraryName}`),
    );
  } catch (error) {
    console.error(
      chalk.red(`Failed to update nest-cli.json: ${error.message}`),
    );
    process.exit(1);
  }
}

export async function updatePackageJson(libraryName: string) {
  const packageJsonPath = path.join(process.cwd(), 'package.json');

  try {
    const packageJsonExists = fs.existsSync(packageJsonPath);
    if (!packageJsonExists) {
      console.log(chalk.red('Error: package.json not found!'));
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

    const newMappingKey = `^@hedhog/${libraryName}(|/.*)$`;
    const newMappingValue = `<rootDir>/libs/${libraryName}/src/$1`;
    packageJsonContent.jest.moduleNameMapper[newMappingKey] = newMappingValue;

    await fs.promises.writeFile(
      packageJsonPath,
      JSON.stringify(packageJsonContent, null, 2),
    );

    console.log(
      chalk.green(
        `Updated package.json with moduleNameMapper for ${libraryName}`,
      ),
    );
  } catch (error) {
    console.error(chalk.red(`Failed to update package.json: ${error.message}`));
    process.exit(1);
  }
}

export async function updateTsconfigPaths(libraryName: string) {
  const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');

  try {
    const tsconfigExists = fs.existsSync(tsconfigPath);
    if (!tsconfigExists) {
      console.log(chalk.red('Error: tsconfig.json not found!'));
      process.exit(1);
    }

    const tsconfigContent = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    if (!tsconfigContent.compilerOptions.paths) {
      tsconfigContent.compilerOptions.paths = {};
    }

    const newPathKey = `@hedhog/${libraryName}`;
    const newPathKeyWithWildcard = `@hedhog/${libraryName}/*`;
    const newPathValue = [`libs/${libraryName}/src`];
    const newPathValueWithWildcard = [`libs/${libraryName}/src/*`];

    tsconfigContent.compilerOptions.paths[newPathKey] = newPathValue;
    tsconfigContent.compilerOptions.paths[newPathKeyWithWildcard] =
      newPathValueWithWildcard;

    await fs.promises.writeFile(
      tsconfigPath,
      JSON.stringify(tsconfigContent, null, 2),
    );

    console.log(chalk.green(`Updated tsconfig.json paths for ${libraryName}`));
  } catch (error) {
    console.error(
      chalk.red(`Failed to update tsconfig.json: ${error.message}`),
    );
    process.exit(1);
  }
}
