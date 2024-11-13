import chalk = require('chalk');
import { Input } from '../commands';
import { PackageManagerFactory } from '../lib/package-managers';
import { AbstractAction } from './abstract.action';
import * as ora from 'ora';
import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'fs/promises';
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
import { parseEnvFile } from '../lib/utils/parse-env-file';
import { EnvFile } from '../lib/types/env-file';
import { getDbTypeFromConnectionString } from '../lib/utils/get-db-type-from-connection-string';
import { EntityFactory } from '../lib/entities/entity.factory';
import { AbstractEntity } from '../lib/entities/abstract.entity';
import { TableFactory } from '../lib/tables/table.factory';
import { AbstractTable } from '../lib/tables/abstract.table';
import { toKebabCase } from '../lib/utils/convert-string-cases';
import path = require('path');

interface TableDependency {
  tableName: string;
  dependencies: string[];
  table?: any;
}

export class AddAction extends AbstractAction {
  private packagesAdded: string[] = [];
  private showWarning = false;

  private db: any = null;
  private isDbConnected: boolean = false;
  private startAt = Date.now();

  private combinedRoutes: any = { routes: [] };

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

    const backendPath = join(directoryPath, 'backend');
    const adminPath = join(directoryPath, 'admin');

    let migrateRun = false;
    const silentComplete =
      options.find(({ name }) => name === 'silentComplete')?.value || false;
    const module = String(
      inputs.find((input) => input.name === 'module')?.value || '',
    ).toLowerCase();

    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    const appModulePath = join(backendPath, 'src', 'app.module.ts');
    const addModuleName = `${this.capitalizeFirstLetter(module)}Module`;
    const packageName = `@hedhog/${module}`;
    const nodeModulePath = join(
      backendPath,
      `node_modules`,
      `@hedhog`,
      `${module}`,
    );

    this.showDebug({
      directoryPath,
      module,
      appModulePath,
      addModuleName,
      packageName,
      nodeModulePath,
      backendPath,
      adminPath,
    });

    /**
     * 2. Get the database connection
     */
    let envVars: any = {};
    try {
      envVars = (await parseEnvFile(join(backendPath, '.env'))) as EnvFile;
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

    this.db.disableAutoClose();

    this.db.on('query', (query: any) =>
      this.showDebug(chalk.bgYellow('Query:'), query),
    );
    this.db.on('transaction', (query: any) =>
      this.showDebug(chalk.bgYellow('Transaction:'), query),
    );

    this.isDbConnected = await this.db.testDatabaseConnection();

    this.showDebug('Database connection status:', this.isDbConnected);

    /**
     * 3. Get the module name
     */

    this.packagesAdded = packagesAdded;

    this.showDebug('Packages added:', this.packagesAdded);

    /* *********************************************************************** */
    try {
      if (!this.checkIfDirectoryIsPackage(directoryPath)) {
        console.error(chalk.red('This directory is not a package.'));
        return;
      }
    } catch (error) {
      console.error(chalk.red('This directory is not a package.', error));
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

    await this.copyFrontEndFiles(directoryPath, nodeModulePath, module);

    if (!silentComplete) {
      await this.updateLibsPrisma(directoryPath);
      await this.complete(module, migrateRun);
    }

    this.showDebug(
      'Total time:',
      this.secondsToHuman((Date.now() - this.startAt) / 1000),
    );

    this.db.close();

    return {
      packagesAdded,
    };
  }

  removeEjsExtension(file: string) {
    return file.replace('.ejs', '');
  }

  async copyFrontEndFiles(
    directoryPath: string,
    nodeModulePath: string,
    module: string,
  ) {
    this.showDebug('copyFrontEndFiles', {
      directoryPath,
      nodeModulePath,
      module,
    });

    if (existsSync(join(nodeModulePath, 'frontend'))) {
      //const spinner = ora('Copying frontend files...').start();
      const frontendPath = join(nodeModulePath, 'frontend');
      const frontendDestPath = join(directoryPath, 'admin', 'src');
      const frontendPagesDestPath = join(frontendDestPath, 'pages', module);
      const frontendFeaturesDestPath = join(
        frontendDestPath,
        'features',
        module,
      );

      for (const dir of await readdir(frontendPath)) {
        this.showDebug('Copy frontend dir:', dir);

        const componentsPath = join(frontendPath, dir, 'components');
        const localesPath = join(frontendPath, dir, 'locales');
        const reactQueryPath = join(frontendPath, dir, 'react-query');
        const screenPath = join(componentsPath, `${dir}.screen.tsx.ejs`);
        const createPanelPath = join(componentsPath, `create-panel.tsx.ejs`);
        const updatePanelPath = join(componentsPath, `update-panel.tsx.ejs`);
        const handlersPath = join(reactQueryPath, 'handlers.ts.ejs');
        const requestsPath = join(reactQueryPath, 'requests.ts.ejs');
        const featuresExports = [];

        const frontendDestPath = join(directoryPath, 'admin', 'src');
        this.createScreenRouterFile(frontendDestPath, module);

        if (existsSync(handlersPath)) {
          this.showDebug('handlersPath', handlersPath);
          await mkdirRecursive(join(frontendFeaturesDestPath, dir));
          await copyFile(
            handlersPath,
            this.removeEjsExtension(
              join(frontendFeaturesDestPath, dir, 'handlers.ts'),
            ),
          );
          featuresExports.push(`export * from './handlers';`);
        }

        if (existsSync(requestsPath)) {
          this.showDebug('requestsPath', requestsPath);
          await mkdirRecursive(join(frontendFeaturesDestPath, dir));
          await copyFile(
            requestsPath,
            this.removeEjsExtension(
              join(frontendFeaturesDestPath, dir, 'requests.ts'),
            ),
          );
          featuresExports.push(`export * from './requests';`);
        }

        if (existsSync(localesPath)) {
          this.showDebug('localesPath', localesPath);
          await mkdirRecursive(join(frontendDestPath, 'locales'));
          for (const localeCode of await readdir(localesPath)) {
            for (const file of await readdir(join(localesPath, localeCode))) {
              await copyFile(
                join(localesPath, localeCode, file),
                join(frontendDestPath, 'locales', localeCode, file),
              );
            }
          }
        }

        if (featuresExports.length > 0) {
          const featuresExportsPath = join(
            frontendFeaturesDestPath,
            dir,
            'index.ts',
          );
          const featuresExportsContent = featuresExports.join('\n');
          await writeFile(featuresExportsPath, featuresExportsContent, 'utf-8');
        }

        if (existsSync(screenPath)) {
          this.showDebug('screenPath', screenPath);
          await mkdirRecursive(join(frontendPagesDestPath, dir));
          await copyFile(
            screenPath,
            join(frontendPagesDestPath, dir, 'index.tsx'),
          );

          await this.parseYAMLFilesToJSON(frontendDestPath);
        }

        if (existsSync(createPanelPath)) {
          this.showDebug('createPanelPath', createPanelPath);
          await mkdirRecursive(join(frontendPagesDestPath, dir, 'components'));
          await copyFile(
            createPanelPath,
            join(
              frontendPagesDestPath,
              dir,
              'components',
              `${toKebabCase(dir)}-create-panel.tsx`,
            ),
          );
        }

        if (existsSync(updatePanelPath)) {
          this.showDebug('updatePanelPath', updatePanelPath);
          await mkdirRecursive(join(frontendPagesDestPath, dir, 'components'));
          await copyFile(
            updatePanelPath,
            join(
              frontendPagesDestPath,
              dir,
              'components',
              `${toKebabCase(dir)}-update-panel.tsx`,
            ),
          );
        }
      }

      this.showDebug({
        frontendPath,
        frontendDestPath,
      });
    }
  }

  async extractArrayFromStringFile(
    fileContent: string,
    searchOpenBracket: string,
  ) {
    fileContent = await formatTypeScriptCode(fileContent, {
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });
    let startIndex = fileContent.indexOf(searchOpenBracket);
    startIndex += searchOpenBracket.length - 1;
    let endIndex = 0;
    let openBracketCount = 0;

    for (let i = startIndex; i < fileContent.length; i++) {
      if (fileContent[i] === '[') {
        openBracketCount++;
      }

      if (fileContent[i] === ']') {
        openBracketCount--;
      }

      if (openBracketCount === 0) {
        endIndex = i + 1;
        break;
      }
    }

    return {
      array: fileContent.substring(startIndex, endIndex),
      start: startIndex,
      end: endIndex,
    };
  }

  async createScreenRouterFile(srcPath: string, module: string) {
    const routesDirPath = path.join(srcPath, 'routes', 'modules');
    const routesYAMLPath = path.join(routesDirPath, `${module}.yaml`);
    await mkdir(routesDirPath, { recursive: true });

    const rootPath = await getRootPath();
    const hedhogFilePath = path.join(
      rootPath,
      'lib',
      'libs',
      toKebabCase(module),
      'hedhog.yaml',
    );

    const YAMLContent = YAML.parse(await readFile(hedhogFilePath, 'utf-8'));
    if (YAMLContent.routes) {
      await writeFile(
        routesYAMLPath,
        YAML.stringify({ routes: YAMLContent.routes }),
        'utf-8',
      );
    } else {
      console.error(
        `No routes found in the YAML content for module ${module}.`,
      );
    }
  }

  private findRouteRecursively(routes: any[], path: string): any | undefined {
    for (const route of routes) {
      if (route.path === path) {
        return route;
      }

      if (route.children && route.children.length > 0) {
        const foundRoute = this.findRouteRecursively(route.children, path);
        if (foundRoute) {
          return foundRoute;
        }
      }
    }

    return undefined;
  }

  private mergeRoutes(targetRoutes: any[], newRoutes: any[]): any[] {
    newRoutes.forEach((newRoute) => {
      const existingRoute = this.findRouteRecursively(
        targetRoutes,
        newRoute.path,
      );

      if (existingRoute) {
        if (newRoute.children && newRoute.children.length > 0) {
          existingRoute.children = this.mergeRoutes(
            existingRoute.children || [],
            newRoute.children,
          );
        }

        if (newRoute.lazy) {
          existingRoute.lazy = newRoute.lazy;
        }
      } else {
        targetRoutes.push(newRoute);
      }
    });

    return targetRoutes;
  }

  private async parseYAMLFilesToJSON(path: string) {
    const routesPath = join(path, 'routes');
    const modulesPath = join(routesPath, 'modules');

    if (existsSync(routesPath)) {
      const routeFiles = await readdir(routesPath);
      for (const file of routeFiles) {
        if (file.endsWith('.yaml') && file !== 'modules') {
          const filePath = join(routesPath, file);
          await this.parseAndMergeYAMLFile(filePath);
        }
      }
    }

    if (existsSync(modulesPath)) {
      const moduleFiles = await readdir(modulesPath);
      for (const file of moduleFiles) {
        if (file.endsWith('.yaml')) {
          const filePath = join(modulesPath, file);
          await this.parseAndMergeYAMLFile(filePath);
        }
      }
    }

    await writeFile(
      join(path, 'routes.json'),
      JSON.stringify(this.combinedRoutes, null, 2),
      'utf-8',
    );
  }

  private async parseAndMergeYAMLFile(filePath: string) {
    const fileContent = await readFile(filePath, 'utf-8');
    const fileData = YAML.parse(fileContent) as any;

    console.log('fileData', fileData);
    console.log('fileData.routes', fileData.routes);

    if (fileData && fileData.routes) {
      this.combinedRoutes.routes = this.mergeRoutes(
        this.combinedRoutes.routes,
        fileData.routes,
      );

      console.log('this.combinedRoutes', this.combinedRoutes);
    }
  }

  secondsToHuman(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const sec = Math.floor(seconds % 60);

    return `${hours}h ${minutes}m ${sec}s`;
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

  async extractTableDependencies(
    data: Record<string, any>,
  ): Promise<TableDependency[]> {
    const result: TableDependency[] = [];

    for (const tableName in data) {
      const tableData = data[tableName];
      let dependencies: Set<string> = new Set();

      // Check for relations
      for (const item of tableData) {
        if (item.relations) {
          const subDeps = (await this.extractTableDependencies(item.relations))
            .map((e) => e.dependencies)
            .flat();

          for (const subDep of subDeps) {
            dependencies.add(subDep);
          }

          for (const relation in item.relations) {
            dependencies.add(relation);
          }
        }

        for (const key in item) {
          if (typeof item[key] === 'object' && item[key] !== null) {
            if (AbstractEntity.isLocale(item, key)) {
              dependencies.add('locale');
            } else if (AbstractEntity.isWhere(item, key)) {
              const tableNameDep = await this.db.getTableNameFromForeignKey(
                tableName,
                key,
              );

              if (tableNameDep !== tableName) {
                dependencies.add(tableNameDep);
              }
            }
          }
        }
      }

      result.push({
        tableName,
        dependencies: Array.from(dependencies),
      });
    }

    return result.sort((a, b) => a.dependencies.length - b.dependencies.length);
  }

  topologicalSort(tables: TableDependency[]) {
    const sortedTables: TableDependency[] = [];
    const visited = new Set<string>();

    const visit = (table: TableDependency) => {
      if (!visited.has(table.tableName)) {
        visited.add(table.tableName);

        for (const dependency of table.dependencies) {
          const depTable = tables.find((t) => t.tableName === dependency);
          if (depTable) visit(depTable);
        }

        sortedTables.push(table);
      }
    };

    for (const table of tables) {
      visit(table);
    }

    return sortedTables;
  }

  sortTablesByDependencies(tables: Record<string, any>) {
    const tableList = [];

    for (const tableName of Object.keys(tables)) {
      const table = tables[tableName];
      const dependencies = AbstractTable.getDependencies(table);

      tableList.push({
        tableName,
        table,
        dependencies,
      });
    }

    const sortedTables = this.topologicalSort(tableList).map(
      (table) => table.tableName,
    );

    return sortedTables;
  }

  async applyHedhogFile(directoryPath: string, module: string) {
    const spinner = ora('Loading Hedhog file..').start();
    let changeStructure = false;
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
      spinner.info('Hedhog file found.');
      try {
        const hedhogFile = await this.parseHedhogFile(filePath);

        this.showDebug('data tables', Object.keys(hedhogFile.data));
        spinner.info('Applying Hedhog file...');

        if (hedhogFile?.tables && this.isDbConnected) {
          this.showDebug('tables before sort', Object.keys(hedhogFile?.tables));
          const tableSorted = this.sortTablesByDependencies(hedhogFile.tables);
          this.showDebug('tables after sort', tableSorted);

          for (const tableName of tableSorted) {
            const table = TableFactory.create(
              this.db,
              tableName,
              hedhogFile?.tables[tableName],
            );

            table.on('debug', (message) =>
              this.showDebug(chalk.bgYellow(`Entity ${tableName}:`), message),
            );
            await table.apply();

            changeStructure = true;

            spinner.succeed(`Entity ${tableName} applied.`);
          }
        }

        if (hedhogFile?.data && this.isDbConnected) {
          spinner.info('Applying Data...');
          for (const data of await this.extractTableDependencies(
            hedhogFile?.data,
          )) {
            const { tableName } = data;

            const entity = EntityFactory.create(
              this.db,
              tableName,
              hedhogFile?.data[tableName],
            );

            entity.on('debug', (message) =>
              this.showDebug(chalk.bgYellow(`Entity ${tableName}:`), message),
            );

            await entity.apply();

            spinner.succeed(`Entity ${tableName} applied.`);
          }
        }

        if (changeStructure) {
          await runScript('prisma:update', join(directoryPath, 'backend'));
          spinner.succeed(`Prisma updated.`);
        }
      } catch (error) {
        spinner.fail(error.message);
      }
    } else {
      spinner.info('Hedhog file not found.');
    }
  }

  async updateLibsPrisma(directoryPath: string) {
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

      if (!existsSync(join(directory, 'admin'))) {
        throw new Error(
          'Directory is not a hedhog project beacaue admin folder not found.',
        );
      }

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
