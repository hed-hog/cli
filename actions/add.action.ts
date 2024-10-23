import chalk = require('chalk');
import { Input } from '../commands';
import { PackageManagerFactory } from '../lib/package-managers';
import { AbstractAction } from './abstract.action';
import * as ora from 'ora';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { BANNER, EMOJIS, MESSAGES } from '../lib/ui';
import { join, sep } from 'path';
import { Runner, RunnerFactory } from '../lib/runners';
import { runScript } from '../lib/utils/run-script';
import { getRootPath } from '../lib/utils/get-root-path';
import { render } from 'ejs';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import { getNpmPackage } from '../lib/utils/get-npm-package';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import * as YAML from 'yaml';
import { Database, DatabaseFactory } from '../lib/databases';
import { applyHedhogFileDataMenus } from '../lib/utils/apply-menus';
import { applyHedhogFileDataRoutes } from '../lib/utils/apply-routes';
import { applyHedhogFileDataScreens } from '../lib/utils/apply-screens';
import { parseEnvFile } from '../lib/utils/parse-env-file';
import { EnvFile } from '../lib/types/env-file';
import { getDbTypeFromConnectionString } from '../lib/utils/get-db-type-from-connection-string';
import { EntityFactory } from '../lib/entities/entity.factory';
import { Entity } from '../lib/entities/entity';

export class AddAction extends AbstractAction {
  private packagesAdded: string[] = [];
  private showWarning = false;
  private debug = false;
  private db: any = null;
  private isDbConnected: boolean = false;

  async showDebug(...args: any[]) {
    if (this.debug) {
      console.log(chalk.yellow('DEBUG'), ...args);
    }
  }

  public async handle(
    inputs: Input[],
    options: Input[],
    packagesAdded: string[] = [],
  ) {
    /**
     * 1. Get variables from the inputs and options
     */

    let directoryPath = '';

    try {
      directoryPath = await getRootPath();
    } catch (error) {
      return console.error(chalk.red('Directory is not a hedhog project.'));
    }

    let migrateRun = false;
    const silentComplete =
      options.find(({ name }) => name === 'silentComplete')?.value || false;
    const module = String(
      inputs.find((input) => input.name === 'module')?.value || '',
    ).toLowerCase();

    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    const appModulePath = join(
      directoryPath,
      'backend',
      'src',
      'app.module.ts',
    );
    const addModuleName = `${this.capitalizeFirstLetter(module)}Module`;
    const packageName = `@hedhog/${module}`;
    const nodeModulePath = join(
      directoryPath,
      `backend`,
      `node_modules`,
      `@hedhog`,
      `${module}`,
    );

    this.showDebug('Root path:', directoryPath);
    this.showDebug('App module path:', appModulePath);
    this.showDebug('Add module name:', addModuleName);

    /**
     * 2. Get the database connection
     */
    let envVars = {} as EnvFile;
    try {
      envVars = await parseEnvFile(join(directoryPath, 'backend', '.env'));
    } catch (error) {
      console.error(chalk.red(`${EMOJIS.ERROR} File .env not found.`));
    }

    this.showDebug('Env vars:', envVars);

    const type = getDbTypeFromConnectionString(envVars.DATABASE_URL);

    this.db = DatabaseFactory.create(
      type === 'mysql' ? Database.MYSQL : Database.POSTGRES,
      envVars.DB_HOST,
      envVars.DB_USERNAME,
      envVars.DB_PASSWORD,
      envVars.DB_DATABASE,
      Number(envVars.DB_PORT),
    );

    this.isDbConnected = await this.db.testDatabaseConnection();

    this.showDebug('Database connection status:', this.isDbConnected);

    this.showDebug(
      'Primary Key Roles Table',
      await this.db.getPrimaryKeys('roles'),
    );
    this.showDebug(
      'ForeignKeys Key Roles Table',
      await this.db.getForeignKeys('roles'),
    );

    this.showDebug(
      'Primary Key RoleUsers Table',
      await this.db.getPrimaryKeys('role_users'),
    );
    this.showDebug(
      'ForeignKeys Key RoleUsers Table',
      await this.db.getForeignKeys('role_users'),
    );

    /**
     * 3. Get the module name
     */

    this.packagesAdded = packagesAdded;

    this.showDebug('Packages added:', this.packagesAdded);

    /* *********************************************************************** */

    if (!this.checkIfDirectoryIsPackage(directoryPath)) {
      console.error(chalk.red('This directory is not a package 22.'));
      return;
    }

    await this.installPackage(directoryPath, packageName);

    await this.checkDependences(directoryPath, module, nodeModulePath);

    await this.checkIfModuleExists(module, nodeModulePath);

    const installedModule = await this.modifyAppModule(
      directoryPath,
      module,
      appModulePath,
      addModuleName,
      packageName,
      nodeModulePath,
    );

    let hasMigrations = false;

    if (installedModule) {
      hasMigrations = await this.copyMigrationsFiles(
        directoryPath,
        nodeModulePath,
      );
    }

    if (this.isDbConnected && hasMigrations) {
      try {
        await runScript('migrate:up', join(directoryPath, 'backend'));
      } catch (error) {
        console.error(chalk.red('Error running migrations.'));
      }
      migrateRun = true;
    }

    await this.applyHedhogFile(directoryPath, module);

    if (module === 'admin') {
      await this.modifyControllerApp(
        join(directoryPath, 'backend', 'src', 'app.controller.ts'),
      );
    }

    if (!silentComplete) {
      await this.updateLibsPrisma(directoryPath);
      await this.complete(module, migrateRun);
    }

    return {
      packagesAdded,
    };
  }

  async parseHedhogFile(path: string) {
    const extension = path.split('.').pop();

    switch (extension) {
      case 'json':
        return require(path);
      case 'yaml':
      case 'yml':
        return YAML.parse(await readFile(path, 'utf-8'));
      default:
        throw new Error('Invalid hedhog file extension.');
    }
  }

  async applyHedhogFile(directoryPath: string, module: string) {
    this.showDebug('applyHedhogFile', { directoryPath, module });

    const path = join(
      directoryPath,
      'backend',
      'node_modules',
      '@hedhog',
      module,
      'hedhog',
    );
    const extensions = ['json', 'yaml', 'yml'];

    const spinner = ora('Loading Hedhog file..').start();
    const extension = extensions.find((ext) => {
      return existsSync(`${path}.${ext}`);
    });
    const filePath = `${path}.${extension}`;

    this.showDebug({
      path,
      extensions,
      extension,
      filePath,
    });

    if (extension) {
      try {
        const hedhogFile = await this.parseHedhogFile(filePath);
        this.showDebug('hedhogFile', hedhogFile);
        spinner.info('Applying Hedhog file...');

        const menus = EntityFactory.create(Entity.menus);

        menus.create();

        this.showDebug('complete');

        /*
        if (hedhogFile?.data && this.isDbConnected) {
          for (const data of Object.keys(hedhogFile?.data)) {
            switch (data) {
              case 'menus':
                await applyHedhogFileDataMenus(this.db, hedhogFile?.data[data]);
                break;

              case 'routes':
                await applyHedhogFileDataRoutes(
                  this.db,
                  hedhogFile?.data[data],
                );
                break;

              case 'screens':
                await applyHedhogFileDataScreens(
                  this.db,
                  hedhogFile?.data[data],
                );
                break;

              default:
                console.warn(chalk.yellow(`Data type "${data}" not found.`));
            }
          }
        }
          */
      } catch (error) {
        spinner.fail(error.message);
      }
    } else {
      spinner.info('Hedhog file not found.');
    }
  }

  async updateLibsPrisma(directoryPath: string) {
    console.log('updateLibsPrisma', directoryPath);
    const spinner = ora('Starting updating prisma in libraries...').start();
    const libPath = join(directoryPath, 'lib');
    const libsPath = join(directoryPath, 'lib', 'libs');

    try {
      if (existsSync(libPath) && existsSync(libsPath)) {
        spinner.info(
          `Database connection status: ${this.isDbConnected ? 'OK' : 'FAIL'}`,
        );

        if (this.isDbConnected) {
          spinner.info('Updating prisma libraries...');
          runScript('prisma:update', libPath);
          spinner.succeed('Prisma libraries updated.');
        } else {
          spinner.warn('Failed to update prisma libraries.');
        }
      } else {
        spinner.info('Libraries not found.');
      }
    } catch (error) {
      spinner.fail('Failed to update prisma libraries.');
      console.error(error);
    }
  }

  async add(module: string) {
    if (!this.packagesAdded.includes(module)) {
      this.packagesAdded.push(module);

      const action = new AddAction();
      const result = await action.handle(
        [{ name: 'module', value: module }],
        [
          { name: 'silentComplete', value: true },
          { name: 'debug', value: this.debug },
        ],
        this.packagesAdded,
      );

      if (result?.packagesAdded) {
        this.packagesAdded = Array.from(
          new Set([...this.packagesAdded, ...result.packagesAdded]),
        );
      }

      return true;
    } else {
      return false;
    }
  }

  async getModuleDependencies(modulePath: string) {
    const packageJsonPath = join(modulePath, 'package.json');

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

  getPackageInstalledModules(directoryPath: string, moduleName: string) {
    const packageJsonMainPath = join(directoryPath, 'package.json');
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

  async checkDependences(
    directoryPath: string,
    moduleName: string,
    modulePath: string,
  ) {
    const moduleDependences = await this.getModuleDependencies(modulePath);
    const packageInstalledModules = this.getPackageInstalledModules(
      directoryPath,
      moduleName,
    );

    const missingDependences = moduleDependences.filter(
      ([name]: [string, any]) =>
        !packageInstalledModules.find(([moduleName]) => moduleName === name),
    );

    for (const [name] of missingDependences) {
      await this.add(name);
    }
  }

  async complete(module: string, migrateRun = false) {
    console.info();
    console.info(chalk.red(BANNER));
    console.info();
    console.info(MESSAGES.PACKAGE_MANAGER_INSTALLATION_SUCCEED(module));
    console.info(MESSAGES.GET_STARTED_INFORMATION);
    if (!migrateRun) {
      console.info();
      console.info(chalk.gray(MESSAGES.RUN_MIGRATE_COMMAND));
    }
    console.info();
  }

  async createDirectoryRecursive(path: string) {
    this.showDebug('Creating directory:', path);
    const folders = path.split(sep);
    let currentPath = folders[0];

    for (let i = 1; i < folders.length; i++) {
      currentPath = join(currentPath, folders[i]);
      this.showDebug(
        'Checking directory:',
        currentPath,
        existsSync(currentPath),
      );
      if (!existsSync(currentPath)) {
        this.showDebug('Creating directory:', currentPath);
        await mkdir(currentPath);
      }
    }
  }

  async copyMigrationsFiles(directoryPath: string, nodeModulePath: string) {
    const spinner = ora('Copying migrations files...').start();
    try {
      let copies = 0;
      const migrationsPath = join(`${nodeModulePath}`, `src`, `migrations`);
      const entitiesPath = join(`${nodeModulePath}`, `src`, `entities`);
      const migrationDestPath = join(
        directoryPath,
        `backend`,
        `src`,
        `typeorm`,
        `migrations`,
      );
      await mkdirRecursive(migrationDestPath);
      const entitiesDestPath = join(
        directoryPath,
        `backend`,
        `src`,
        `typeorm`,
        `entities`,
      );
      await mkdirRecursive(entitiesDestPath);

      this.showDebug({
        migrationsPath,
        migrationDestPath,
        entitiesPath,
        entitiesDestPath,
      });

      if (existsSync(entitiesPath)) {
        let entitiesFiles = (await readdir(entitiesPath))
          .filter((file) => file.endsWith('.ts'))
          .filter((file) => !file.endsWith('.d.ts'));

        for (const file of entitiesFiles) {
          const fileContent = await readFile(`${entitiesPath}/${file}`, 'utf8');
          const fileContentFinal = await formatTypeScriptCode(fileContent);

          this.showDebug('Copy entity file:', file, ' to ', `${file}`);

          await writeFile(join(entitiesDestPath, file), fileContentFinal);
        }

        spinner.succeed('Entities files copied.');
      }

      if (existsSync(migrationsPath)) {
        spinner.info('Copying migrations files...');

        let migrationsFiles = (await readdir(migrationsPath))
          .filter((file) => file.endsWith('.ts'))
          .filter((file) => !file.endsWith('.d.ts'));

        for (const file of migrationsFiles) {
          const timestamp = new Date().getTime();
          const fileContent = await readFile(
            `${migrationsPath}/${file}`,
            'utf8',
          );

          const fileContentFinal = await formatTypeScriptCode(
            fileContent.replace(
              /export class Migrate implements/g,
              `export class Migrate${timestamp} implements`,
            ),
          );

          this.showDebug(
            'Copy migration file:',
            file,
            ' to ',
            `${timestamp}-migrate.ts`,
          );

          await writeFile(
            join(
              directoryPath,
              `backend`,
              `src`,
              `typeorm`,
              `migrations`,
              `${timestamp}-migrate.ts`,
            ),
            fileContentFinal,
          );

          copies++;
        }

        spinner.succeed('Migrations files copied.');
        return copies > 0;
      } else {
        spinner.info('No migrations files found.');
        return false;
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

  async modifyControllerApp(path: string) {
    let alreadyInstalled = false;
    let fileContent = await readFile(path, 'utf-8');

    if (['@Public()'].includes(fileContent)) {
      return;
    }

    fileContent = await formatTypeScriptCode(fileContent, {
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });

    const importStatement = `import { Public } from '@hedhog/admin';`;
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
      if (this.showWarning) {
        console.warn(
          chalk.yellow(`${EMOJIS.WARNING} The row for already exists.`),
        );
      }
      alreadyInstalled = true;
    }

    if (alreadyInstalled) {
      return false;
    }

    const updatedFileContent = await formatTypeScriptCode(
      `${fileContent}`.replace(`@Controller()`, `@Public()\n@Controller()\n`),
      {
        singleQuote: true,
        trailingComma: 'all',
        semi: true,
      },
    );

    await writeFile(path, updatedFileContent, 'utf-8');
  }

  async modifyAppModule(
    directoryPath: string,
    module: string,
    filePath: string,
    newModule: string,
    newModulePath: string,
    nodeModulePath: string,
  ) {
    let alreadyInstalled = false;

    if (['UtilsModule'].includes(newModule)) {
      return;
    }

    let fileContent = await readFile(filePath, 'utf-8');

    fileContent = await formatTypeScriptCode(fileContent, {
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });

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
      if (this.showWarning) {
        console.warn(
          chalk.yellow(
            `${EMOJIS.WARNING} The row for "${newModule}" module already exists.`,
          ),
        );
      }
      alreadyInstalled = true;
    }

    let importsMatch;
    const importFind = 'imports: [';
    const startImportsIndex =
      fileContent.indexOf(importFind) + importFind.length;
    let endImportsIndex = 0;
    let openBracketCount = 1;

    for (let i = startImportsIndex; i < fileContent.length; i++) {
      if (fileContent[i] === '[') {
        openBracketCount++;
      }

      if (fileContent[i] === ']') {
        openBracketCount--;
      }

      if (openBracketCount === 0) {
        endImportsIndex = i + 1;
        importsMatch = fileContent.substring(startImportsIndex, i);
        break;
      }
    }

    if (!importsMatch) {
      console.error(
        chalk.red(
          `${EMOJIS.ERROR} "imports" property not found in @Module decorator.`,
        ),
      );
      return;
    }

    // Separa a lista de imports
    const importsList: string[] = [];

    openBracketCount = 0;
    let openBracesCount = 0;

    for (let i = 0; i < importsMatch.length; i++) {
      if (importsMatch[i] === '[') {
        openBracketCount++;
      }

      if (importsMatch[i] === ']') {
        openBracketCount--;
      }

      if (importsMatch[i] === '{') {
        openBracesCount++;
      }

      if (importsMatch[i] === '}') {
        openBracesCount--;
      }

      if (openBracketCount === 0 && openBracesCount === 0) {
        if (importsMatch[i] === ',') {
          if (importsMatch.substring(0, i).trim()) {
            importsList.push(importsMatch.substring(0, i).trim());
          }
          importsMatch = importsMatch.substring(i + 1);
          i = 0;
        }
      }
    }

    if (importsMatch.trim()) {
      importsList.push(importsMatch.trim());
    }

    const moduleTemplatePath = join(
      nodeModulePath,
      'src',
      `${module}.template.ejs`,
    );

    let newModuleTemplate = `${newModule}`;

    if (existsSync(moduleTemplatePath)) {
      const templateContent = await readFile(moduleTemplatePath, 'utf-8');
      newModuleTemplate = render(templateContent, {});
    }

    // Verifica se o módulo já foi importado
    const alreadyImported = importsList.some((imp) =>
      imp.includes(newModuleTemplate),
    );

    if (alreadyImported) {
      if (this.showWarning) {
        console.warn(
          chalk.yellow(
            `${EMOJIS.WARNING} The "${newModule}" module is already imported.`,
          ),
        );
      }
      alreadyInstalled = true;
    }

    if (alreadyInstalled) {
      return false;
    }

    importsList.push(newModuleTemplate);

    const startFileContent = fileContent.substring(0, startImportsIndex);
    const endFileContent = fileContent.substring(endImportsIndex - 1);

    try {
      const updatedFileContent = await formatTypeScriptCode(
        `${startFileContent}${importsList.join(', ')}${endFileContent}`,
        {
          singleQuote: true,
          trailingComma: 'all',
          semi: true,
        },
      );

      await writeFile(filePath, updatedFileContent, 'utf-8');
    } catch (error) {
      console.info(
        chalk.blue('Not possible add module, the original file was restored.'),
      );

      await writeFile(
        filePath,
        await formatTypeScriptCode(fileContent, {
          singleQuote: true,
          trailingComma: 'all',
          semi: true,
        }),
        'utf-8',
      );
      try {
        await runScript(`format`, join(directoryPath, 'backend'));
      } catch (error) {
        console.error(chalk.red('Error formatting file app.module.ts'));
      }
    }

    return true;
  }

  async checkIfModuleExists(module: string, nodeModulePath: string) {
    const spinner = ora('Checking module installed...').start();
    const path = join(nodeModulePath, 'dist', `${module}.module.js`);

    try {
      await readFile(path);
      spinner.succeed(`Module ${module} installed.`);
      return true;
    } catch (error) {
      spinner.warn(`Module ${module} not installed.`);
      return false;
    }
  }

  checkIfDirectoryIsPackage(directory: string) {
    try {
      const packageJson = require(`${directory}/package.json`);

      if (!existsSync(join(directory, 'backend'))) {
        throw new Error(
          'Directory is not a hedhog project beacaue backend folder not found.',
        );
      }
      /*
      if (!existsSync(join(directory, 'admin'))) {
        throw new Error(
          'Directory is not a hedhog project beacaue admin folder not found.',
        );
      }
      */

      return packageJson;
    } catch (error) {
      console.error(chalk.red('Directory is not a package.'));
      return false;
    }
  }

  capitalizeFirstLetter(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  async getLatestVersion(module: string) {
    const {
      'dist-tags': { latest: latestVersion },
    } = await getNpmPackage(module);

    return latestVersion;
  }

  async checkIfPackageExists(directoryPath: string, module: string) {
    const packageJson = require(join(directoryPath, 'backend', 'package.json'));

    if (packageJson.dependencies[module]) {
      const currentVersion = packageJson.dependencies[module];
      const latestVersion = await this.getLatestVersion(module);
      const currentVersionParts = currentVersion.split('.');
      const latestVersionParts = latestVersion.split('.');
      let isLatest = true;

      for (let i = 0; i < currentVersionParts.length; i++) {
        if (
          parseInt(currentVersionParts[i]) < parseInt(latestVersionParts[i])
        ) {
          isLatest = false;
          break;
        }
      }

      return isLatest;
    }

    return false;
  }

  async installPackage(directoryPath: string, module: string) {
    if (!(await this.checkIfPackageExists(directoryPath, module))) {
      const packageManager = await PackageManagerFactory.find();
      return packageManager.addProduction(
        [module],
        'latest',
        join(directoryPath, 'backend'),
      );
    } else {
      return true;
    }
  }
}
