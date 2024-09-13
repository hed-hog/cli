import chalk = require('chalk');
import { Input } from '../commands';
import { PackageManagerFactory } from '../lib/package-managers';
import { AbstractAction } from './abstract.action';
import * as ora from 'ora';
import { existsSync } from 'fs';
import { readdir, readFile, writeFile } from 'fs/promises';
import { MESSAGES } from '../lib/ui';
import { join } from 'path';
import { Runner, RunnerFactory } from '../lib/runners';

export class AddAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const silentComplete =
      options.find(({ name }) => name === 'silentComplete')?.value || false;
    const module = String(
      inputs.find((input) => input.name === 'module')?.value || '',
    ).toLowerCase();
    const appModuleName = 'app.module.ts';
    const appModulePath = `src/${appModuleName}`;
    const addModuleName = `${this.capitalizeFirstLetter(module)}Module`;
    const packageName = `@hedhog/${module}`;
    const directoryPath = process.cwd();
    const nodeModulePath = `node_modules/@hedhog/${module}`;

    if (!this.checkIfDirectoryIsPackage(directoryPath)) {
      console.error(chalk.red('This directory is not a package.'));
      return;
    }

    await this.installPackage(packageName);

    await this.checkDependences(module, nodeModulePath);

    await this.checkIfModuleExists(module, nodeModulePath);

    await this.modifyAppModule(appModulePath, addModuleName, packageName);

    await this.copyMigrationsFiles(nodeModulePath);

    if (!silentComplete) {
      await this.complete(module);
    }
  }

  async add(module: string) {
    const action = new AddAction();
    return action.handle(
      [{ name: 'module', value: module }],
      [{ name: 'silentComplete', value: true }],
    );
  }

  async getModuleDependencies(modulePath: string) {
    const packageJsonPath = join(process.cwd(), modulePath, 'package.json');

    if (!existsSync(packageJsonPath)) {
      throw new Error('package.json not found.');
    }

    const packageJson = require(packageJsonPath);

    const dependencies = Object.assign(
      packageJson.dependencies ?? {},
      packageJson.devDependencies ?? {},
    );

    const hedhogDependencies: any[] = [];

    for (const [key, value] of Object.entries(dependencies)) {
      if (key.startsWith('@hedhog/')) {
        hedhogDependencies.push([key.split('@hedhog/')[1], value]);
      }
    }

    return hedhogDependencies;
  }

  getPackageInstalledModules(moduleName: string) {
    const packageJsonMainPath = join(process.cwd(), 'package.json');

    const packageJsonMain = require(packageJsonMainPath);

    const hedhogModules: any[] = [];

    for (const [key, value] of Object.entries(
      packageJsonMain.dependencies ?? {},
    )) {
      if (
        key.startsWith('@hedhog/') &&
        key.split('@hedhog/')[1] !== moduleName
      ) {
        hedhogModules.push([key.split('@hedhog/')[1], value]);
      }
    }

    return hedhogModules;
  }

  async checkDependences(moduleName: string, modulePath: string) {
    const moduleDependences = await this.getModuleDependencies(modulePath);
    const packageInstalledModules = this.getPackageInstalledModules(moduleName);

    const missingDependences = moduleDependences.filter(
      ([name]: [string, any]) =>
        !packageInstalledModules.find(([moduleName]) => moduleName === name),
    );

    for (const [name] of missingDependences) {
      await this.add(name);
    }
  }

  async complete(module: string) {
    console.info();
    console.info(MESSAGES.PACKAGE_MANAGER_INSTALLATION_SUCCEED(module));
    console.info(MESSAGES.GET_STARTED_INFORMATION);
    console.info();
    console.info(chalk.gray(MESSAGES.RUN_MIGRATE_COMMAND));
    console.info();
  }

  async copyMigrationsFiles(nodeModulePath: string) {
    const spinner = ora('Copying migrations files...').start();
    try {
      const migrationsPath = `${nodeModulePath}/src/migrations`;

      if (existsSync(migrationsPath)) {
        let migrationsFiles = (await readdir(migrationsPath))
          .filter((file) => file.endsWith('.ts'))
          .filter((file) => !file.endsWith('.d.ts'));

        for (const file of migrationsFiles) {
          const timestamp = new Date().getTime();
          const fileContent = await readFile(
            `${migrationsPath}/${file}`,
            'utf8',
          );

          await writeFile(
            `src/typeorm/migrations/${timestamp}-migrate.ts`,
            fileContent.replace(
              /export class Migrate implements/g,
              `export class Migrate${timestamp} implements`,
            ),
          );
        }

        spinner.succeed('Migrations files copied.');
        return true;
      } else {
        spinner.info('No migrations files found.');
      }
    } catch (error) {
      spinner.fail(error.message);
      return false;
    }
  }

  async npx(args: string) {
    const spinner = ora('Creating library directory').start();
    const runner = RunnerFactory.create(Runner.NPX);
    await runner?.run(args);
    spinner.succeed();
  }

  async modifyAppModule(
    filePath: string,
    newModule: string,
    newModulePath: string,
  ) {
    // Lê o conteúdo do arquivo
    let fileContent = await readFile(filePath, 'utf-8');

    // Verifica se a linha de import já existe
    const importStatement = `import { ${newModule} } from '${newModulePath}';`;
    if (!fileContent.includes(importStatement)) {
      // Adiciona a linha de import no início do arquivo (após os outros imports)
      const importRegex = /(import[\s\S]+?;)/g;
      const importMatch = importRegex.exec(fileContent);
      if (importMatch) {
        const lastImport = importMatch[0];
        fileContent = fileContent.replace(
          lastImport,
          `${lastImport}\n${importStatement}`,
        );
      } else {
        // Se nenhum import estiver presente, adiciona no início do arquivo
        fileContent = `${importStatement}\n\n${fileContent}`;
      }
    } else {
      console.log(`A linha de import para "${newModule}" já está presente.`);
    }

    // Encontra o decorador @Module
    const moduleRegex = /@Module\s*\(\s*{([\s\S]*?)}\s*\)/g;
    const moduleMatch = moduleRegex.exec(fileContent);

    if (!moduleMatch) {
      console.error('Decorador @Module não encontrado.');
      return;
    }

    // Pega o conteúdo do decorador @Module
    let moduleContent = moduleMatch[1];

    // Regex para encontrar o array de imports dentro do decorador
    const importsRegex = /(imports\s*:\s*\[)([\s\S]*?)(\])/;
    const importsMatch = importsRegex.exec(moduleContent);

    if (!importsMatch) {
      console.error('Propriedade "imports" não encontrada.');
      return;
    }

    let importsList = importsMatch[2].split(',').map((imp) => imp.trim());

    // Verifica se o módulo já foi importado
    const alreadyImported = importsList.some((imp) => imp.includes(newModule));

    if (alreadyImported) {
      console.log(`O módulo "${newModule}" já está presente nos imports.`);
      return;
    }

    // Adiciona o novo módulo no início da lista
    importsList.unshift(newModule);

    // Recria a seção de imports
    const updatedImports = `imports: [${importsList.join(', ')}]`;

    // Substitui o bloco original de imports pelo atualizado
    moduleContent = moduleContent.replace(importsMatch[0], updatedImports);

    // Substitui o decorador original pelo atualizado
    const updatedFileContent = fileContent.replace(
      moduleMatch[1],
      moduleContent,
    );

    // Escreve o conteúdo atualizado de volta no arquivo
    await writeFile(filePath, updatedFileContent, 'utf-8');

    await this.npx(`prettier --write ${filePath}`);
  }

  async addModuleImportToAppModule(
    module: string,
    addModuleName: string,
    moduleImport: string,
    appModulePath: string,
  ) {
    const spinner = ora('Adding module to app module...').start();
    if (!['utils'].includes(module.toLowerCase())) {
      try {
        let appModuleContent = await readFile(appModulePath, 'utf8');

        spinner.text = 'Checking if module already exists in app module...';

        if (appModuleContent.includes(moduleImport)) {
          spinner.warn('Module already exists in app module.');
          return false;
        }

        spinner.text = 'Adding module to app module...';

        appModuleContent = `${moduleImport}
${appModuleContent}
      `;

        appModuleContent = appModuleContent.replace(
          /(\n\s*imports:\s*\[[\s\S]*?)(\n\s*\])/m,
          `$1\n    ${addModuleName},$2`,
        );

        spinner.text = 'Writing changes to app module...';

        await writeFile(appModulePath, appModuleContent);

        spinner.succeed('Module added to app module.');

        return true;
      } catch (error) {
        spinner.fail(error.message);

        return false;
      }
    } else {
      spinner.succeed('Module import skipped.');
      return false;
    }
  }

  async checkIfModuleExists(module: string, nodeModulePath: string) {
    const spinner = ora('Checking module installed...').start();
    const path = `${nodeModulePath}/dist/${module}.module.js`;

    try {
      await readFile(path);
      spinner.succeed(`Module ${module} installed.`);
      return true;
    } catch (error) {
      spinner.fail(`Module ${module} not installed.`);
      return false;
    }
  }

  checkIfDirectoryIsPackage(directory: string) {
    const spinner = ora('Checking directory...').start();
    try {
      const packageJson = require(`${directory}/package.json`);

      if (!packageJson.dependencies['@nestjs/core']) {
        throw new Error('Directory is not a package.');
      }

      spinner.succeed('Directory is a package.');
      return packageJson;
    } catch (error) {
      spinner.fail('Directory is not a package.');
      return false;
    }
  }

  capitalizeFirstLetter(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  async installPackage(module: string) {
    const packageManager = await PackageManagerFactory.find();
    const result = await packageManager.addProduction([module], 'latest');

    return result;
  }
}
