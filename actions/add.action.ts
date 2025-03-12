import chalk = require('chalk');
import { render } from 'ejs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import * as ora from 'ora';
import * as YAML from 'yaml';
import { Input } from '../commands';
import { Database, DatabaseFactory } from '../lib/databases';
import { AbstractEntity } from '../lib/entities/abstract.entity';
import { EntityFactory } from '../lib/entities/entity.factory';
import { PackageManagerFactory } from '../lib/package-managers';
import { Runner, RunnerFactory } from '../lib/runners';
import { AbstractTable } from '../lib/tables/abstract.table';
import { TableFactory } from '../lib/tables/table.factory';
import type { AddPackagesResult } from '../lib/types/add-packages-result';
import { BANNER, EMOJIS, MESSAGES } from '../lib/ui';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import { getDbTypeFromConnectionString } from '../lib/utils/get-db-type-from-connection-string';
import { getNpmPackage } from '../lib/utils/get-npm-package';
import { getRootPath } from '../lib/utils/get-root-path';
import { loadHedhogFile } from '../lib/utils/load-hedhog-file';
import { runScript } from '../lib/utils/run-script';
import { AbstractAction } from './abstract.action';

interface TableDependency {
  tableName: string;
  dependencies: string[];
  table?: any;
}

type RouteObject = {
  path: string;
  originalPath?: string;
  component?: string;
  lazy?: {
    component: string;
  };
  children?: RouteObject[];
  content?: string;
};

export class AddAction extends AbstractAction {
  private packagesAdded: string[] = [];
  private showWarning = false;
  private routes: RouteObject[] = [];
  private routesRecursive: RouteObject[] = [];
  private db: any = null;
  private isDbConnected: boolean = false;
  private startAt = Date.now();
  private directoryPath = '';
  private backendPath = '';
  private adminPath = '';
  private srcPath = '';
  private appControllerPath = '';
  private appModulePath = '';
  private silentComplete = false;
  private module = '';
  private migrateRun = false;
  private addModuleName = '';
  private packageName = '';
  private nodeModulePath = '';
  private isAlreadyInstalled = false;

  private hasMigrations = false;

  /**
   * Initializes various paths required for module setup.
   *
   * This method sets up the directory paths for the backend, admin,
   * app module, app controller, and node modules. It retrieves the root
   * directory path and constructs specific sub-paths for different components.
   * Additionally, it logs debugging information about the initialized paths.
   *
   * Throws an error if the current directory is not a valid Hedhog project.
   */
  private async initPaths(): Promise<void> {
    try {
      this.directoryPath = await getRootPath();
      this.backendPath = join(this.directoryPath, 'backend');
      this.adminPath = join(this.directoryPath, 'admin');
      this.appModulePath = join(this.backendPath, 'src', 'app.module.ts');
      (this.appControllerPath = join(
        this.backendPath,
        'src',
        'app.controller.ts',
      )),
        (this.nodeModulePath = join(
          this.backendPath,
          `node_modules`,
          `@hedhog`,
          `${this.module}`,
        ));
      this.srcPath = join(this.adminPath, 'src');

      this.showDebug({
        directoryPath: this.directoryPath,
        module: this.module,
        appModulePath: this.appModulePath,
        addModuleName: this.addModuleName,
        packageName: this.packageName,
        nodeModulePath: this.nodeModulePath,
        backendPath: this.backendPath,
        adminPath: this.adminPath,
      });
    } catch (error) {
      return console.error(chalk.red('Directory is not a hedhog project.'));
    }
  }

  /**
   * Initializes module name and package name variables.
   *
   * This method takes the value of the `module` property and initializes
   * the `addModuleName` and `packageName` properties. The `addModuleName`
   * is set to the name of the module with the first letter capitalized
   * followed by 'Module', and the `packageName` is set to the name of the
   * package prefixed with '@hedhog/'.
   * @returns {void}
   */
  private async initNames(): Promise<void> {
    this.addModuleName = `${this.capitalizeFirstLetter(this.module)}Module`;
    this.packageName = `@hedhog/${this.module}`;
  }

  /**
   * Initializes database connection.
   *
   * This method parses the environment file, extracts database connection
   * parameters, and creates a database instance. It also sets up event listeners
   * for queries and transactions. Finally, it tests whether the database
   * connection is successful and logs the connection status.
   *
   * @returns {Promise<void>}
   */
  private async initDb(): Promise<void> {
    const envVars = await this.parseEnvFile(join(this.backendPath, '.env'));
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
  }

  /**
   * Handles the add action.
   *
   * This method takes an array of inputs and options, and an optional array of
   * packages that have been added. It initializes the paths, module name, and
   * package name, and checks if the package is already installed. If the package
   * is not installed, it installs the package and checks its dependencies. It
   * then checks if the module exists and applies the Hedhog file. Finally, it
   * copies the frontend files, updates the libs prisma, and completes the action.
   *
   * @param {Input[]} inputs - An array of inputs for the add action.
   * @param {Input[]} options - An array of options for the add action.
   * @param {string[]} packagesAdded - An optional array of packages that have been added.
   * @returns {Promise<AddPackagesResult>} A promise that resolves with an object containing the packages added.
   */
  public async handle(
    inputs: Input[],
    options: Input[],
    packagesAdded: string[] = [],
  ): Promise<AddPackagesResult> {
    this.silentComplete = Boolean(
      options.find(({ name }) => name === 'silentComplete')?.value,
    );

    this.module = String(
      inputs.find((input) => input.name === 'module')?.value || '',
    ).toLowerCase();

    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    await this.initPaths();
    await this.initNames();
    await this.initDb();

    this.packagesAdded = packagesAdded;
    this.isAlreadyInstalled = await this.alreadyInstalled();

    console.log({
      packageName: this.packageName,
      alreadyInstalled: this.isAlreadyInstalled,
    });

    if (!this.isAlreadyInstalled) {
      await this.installPackage();
      await this.checkDependencies();
      await this.checkIfModuleExists();

      const installedModule = await this.modifyAppModule();
      this.hasMigrations = false;

      if (installedModule) {
        this.hasMigrations = await this.copyMigrationsFiles();
      }

      if (this.isDbConnected && this.hasMigrations) {
        try {
          await runScript('migrate:up', this.backendPath);
        } catch (error) {
          console.error(chalk.red('Error running migrations.'));
        }
        this.migrateRun = true;
      }

      await this.applyHedhogFile();
      if (this.module === 'admin') {
        await this.modifyControllerApp();
      }

      await this.copyFrontEndFiles();
    }

    if (!this.silentComplete) {
      await this.updateLibsPrisma();
      await this.complete();
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

  async alreadyInstalled(): Promise<boolean> {
    const packageJsonPath = join(this.backendPath, 'package.json');
    if (!existsSync(packageJsonPath)) return false;
    try {
      const packageJson = await readFile(packageJsonPath, 'utf-8');
      const { dependencies } = JSON.parse(packageJson);
      return dependencies?.[this.packageName] !== undefined;
    } catch (error) {
      console.error('Error reading or parsing package.json:', error);
      return false;
    }
  }

  // route management
  applyOriginalPathsRecursive(routes: RouteObject[]) {
    return this.removeDuplicates(
      routes.map((route) => {
        if (route.children) {
          route.children = this.applyOriginalPathsRecursive(route.children);
        }

        if (route.originalPath) {
          route.path = route.originalPath;
        }

        delete route.originalPath;

        if (route.children?.length === 0) {
          delete route.children;
        }

        return route;
      }),
    );
  }

  // route management
  convertToString(routes: RouteObject[]) {
    return routes.map((route) => {
      const lines = [];

      lines.push(`path: '${route.path}'`);

      if (route.lazy) {
        lines.push(
          `lazy: async () => ({ Component: (await import('${route.lazy.component}')).default})`,
        );
      }

      if (route.children) {
        route.children = this.convertToString(route.children);

        const childrenContent = route.children.map((child) => child.content);

        lines.push(`children: [${childrenContent.join(',\n')}]`);
      }

      route.content = `{ ${lines.join(',')} }`;

      return route;
    });
  }

  // route management
  removeDuplicates(routes: RouteObject[]): RouteObject[] {
    const map = new Map<string, RouteObject>();

    for (const route of routes) {
      const existingRoute = map.get(route.path);

      if (existingRoute) {
        if (existingRoute.children) {
          continue;
        } else if (route.children) {
          map.set(route.path, route);
        }
      } else {
        map.set(route.path, route);
      }
    }

    return Array.from(map.values());
  }

  // route management
  sortRoutes(routeObjects: RouteObject[]) {
    return routeObjects.sort((a, b) => {
      if (a.path === null) {
        return -1;
      }

      if (b.path === null) {
        return 1;
      }

      if (a.path < b.path) {
        return -1;
      }
      if (a.path > b.path) {
        return 1;
      }
      return 0;
    });
  }

  // route management
  async extractPathsFromRoutes(
    parentPath: string,
    routeObjects: RouteObject[],
  ) {
    console.log('extractPathsFromRoutes', {
      parentPath,
      routeObjects,
    });

    for (const routeObject of routeObjects) {
      const fullPath = [parentPath, routeObject.path]
        .join('/')
        .replaceAll('//', '/');

      if (routeObject?.children) {
        await this.extractPathsFromRoutes(fullPath, routeObject?.children);
      }

      const newRouteObject: RouteObject = {
        path: fullPath,
        originalPath: routeObject.path,
        component: routeObject.component,
        lazy: routeObject.lazy,
      };

      if (!this.routes.map((route) => route.path).includes(fullPath)) {
        this.routes.push(newRouteObject);
      }
    }
  }

  // route management
  private buildRoutesTree(flatRoutes: RouteObject[]): RouteObject[] {
    const routeTree: RouteObject[] = [];

    for (const route of flatRoutes) {
      const path = route.path;
      const isIndexRoute = path.endsWith('/');
      const segments = path.split('/').filter((segment) => segment.length > 0);
      this.insertRoute(route, segments, routeTree, isIndexRoute);
    }

    return routeTree;
  }

  // route management
  private insertRoute(
    route: RouteObject,
    segments: string[],
    routes: RouteObject[],
    isIndexRoute: boolean,
  ) {
    if (segments.length === 0) {
      if (!routes.map((r) => r.path).includes(route.path)) {
        routes.push(route);
      }
      return;
    }

    const [currentSegment, ...remainingSegments] = segments;
    let node = routes.find((r) => r.path === currentSegment);

    if (!node) {
      node = { path: currentSegment, children: [] } as unknown as RouteObject;
      if (!routes.map((r) => r.path).includes(node.path)) {
        routes.push(node);
      }
    }

    if (remainingSegments.length === 0) {
      if (isIndexRoute) {
        // Rota de índice
        if (!node.children) {
          node.children = [];
        }
        const indexRoute = { ...route, path: '', index: true };
        if (!node.children.map((r) => r.path).includes(indexRoute.path)) {
          node.children.push(indexRoute);
        }
      } else {
        // Rota final
        Object.assign(node, route);
      }
    } else {
      if (!node.children) {
        node.children = [];
      }
      this.insertRoute(route, remainingSegments, node.children, isIndexRoute);
    }
  }

  removeEjsExtension(file: string) {
    return file.replace('.ejs', '');
  }

  async createModuleRoutesFile(hedhogPath: string, frontendDestPath: string) {
    const hedHogFile = await loadHedhogFile(hedhogPath);

    if (hedHogFile.routes) {
      await writeFile(
        join(frontendDestPath, 'routes', 'modules', `${this.module}.yaml`),
        YAML.stringify({ routes: hedHogFile.routes }),
        'utf-8',
      );
    }
  }

  async copyFrontEndFiles() {
    this.showDebug('copyFrontEndFiles', {
      directoryPath: this.directoryPath,
      nodeModulePath: this.nodeModulePath,
      module: this.module,
    });

    if (existsSync(join(this.nodeModulePath, 'frontend'))) {
      const hedhogPath = join(this.nodeModulePath, 'hedhog.yaml');
      const frontendPath = join(this.nodeModulePath, 'frontend');
      const frontendDestPath = join(this.directoryPath, 'admin', 'src');
      const frontendPagesDestPath = join(
        frontendDestPath,
        'pages',
        this.module,
      );
      const frontendFeaturesDestPath = join(
        frontendDestPath,
        'features',
        this.module,
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

        const frontendDestPath = join(this.directoryPath, 'admin', 'src');
        this.createScreenRouterFile();
        const translationModulesPath = join(
          frontendPath,
          'translation',
          'modules',
        );
        const translationFieldsPath = join(
          frontendPath,
          'translation',
          'fields',
        );

        if (existsSync(translationModulesPath)) {
          const localesDestPath = join(frontendDestPath, 'locales');
          await mkdirRecursive(localesDestPath);

          for (const localeFile of await readdir(translationModulesPath)) {
            const localeCode = localeFile.split('.')[0];
            const localeDestPath = join(
              localesDestPath,
              localeCode,
              'modules.json',
            );
            await mkdirRecursive(join(localesDestPath, localeCode));

            if (existsSync(localeDestPath)) {
              const existingContent = JSON.parse(
                await readFile(localeDestPath, 'utf-8'),
              );
              const newContent = JSON.parse(
                await readFile(
                  join(translationModulesPath, localeFile),
                  'utf-8',
                ),
              );
              const mergedContent = { ...existingContent, ...newContent };
              await writeFile(
                localeDestPath,
                JSON.stringify(mergedContent, null, 2),
                'utf-8',
              );
            } else {
              await copyFile(
                join(translationModulesPath, localeFile),
                localeDestPath,
              );
            }
          }
        }

        if (existsSync(translationFieldsPath)) {
          const localesDestPath = join(frontendDestPath, 'locales');
          await mkdirRecursive(localesDestPath);

          for (const localeFile of await readdir(translationFieldsPath)) {
            const localeCode = localeFile.split('.')[0];
            const localeDestPath = join(
              localesDestPath,
              localeCode,
              'fields.json',
            );
            await mkdirRecursive(join(localesDestPath, localeCode));

            if (existsSync(localeDestPath)) {
              const existingContent = JSON.parse(
                await readFile(localeDestPath, 'utf-8'),
              );
              const newContent = JSON.parse(
                await readFile(
                  join(translationFieldsPath, localeFile),
                  'utf-8',
                ),
              );
              const mergedContent = { ...existingContent, ...newContent };
              await writeFile(
                localeDestPath,
                JSON.stringify(mergedContent, null, 2),
                'utf-8',
              );
            } else {
              await copyFile(
                join(translationFieldsPath, localeFile),
                localeDestPath,
              );
            }
          }
        }

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
              `${dir.toKebabCase()}-create-panel.tsx`,
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
              `${dir.toKebabCase()}-update-panel.tsx`,
            ),
          );
        }
      }

      await this.createModuleRoutesFile(hedhogPath, frontendDestPath);

      const routesMainPath = join(frontendDestPath, 'routes', 'main.yaml');
      const routesModulesPath = join(frontendDestPath, 'routes', 'modules');
      const routePaths = [routesMainPath];

      for (const file of await readdir(routesModulesPath)) {
        console.log('route file', file);
        routePaths.push(join(routesModulesPath, file));
      }

      console.log({ routePaths });

      const routeObjects = [];

      for (const path of routePaths) {
        const headhogFile = await loadHedhogFile(path);
        routeObjects.push(...(headhogFile?.routes ?? []));
      }

      await this.extractPathsFromRoutes('', routeObjects);

      this.routes = this.sortRoutes(this.routes);
      this.routesRecursive = this.buildRoutesTree(this.routes);
      this.routesRecursive = this.applyOriginalPathsRecursive(
        this.routesRecursive,
      );

      const varTemplate = `${this.convertToString(this.routesRecursive)
        .map((route) => route.content)
        .join(',')}`;

      const routerTemplatePath = join(
        __dirname,
        '..',
        'templates',
        'route',
        'router.tsx.ejs',
      );
      const routerDestPath = join(frontendDestPath, 'router.tsx');

      if (existsSync(routerTemplatePath)) {
        const templateContent = await readFile(routerTemplatePath, 'utf-8');
        const renderedContent = await formatTypeScriptCode(
          render(templateContent, {
            routes: varTemplate,
          }),
        );

        await writeFile(routerDestPath, renderedContent, 'utf-8');
      } else {
        console.warn(`Router template not found at ${routerTemplatePath}`);
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

  async createScreenRouterFile() {
    const routesDirPath = join(this.srcPath, 'routes', 'modules');
    const routesYAMLPath = join(routesDirPath, `${this.module}.yaml`);
    await mkdir(routesDirPath, { recursive: true });
    const backendPath = join('', 'backend');
    const hedhogFilePath = join(
      backendPath,
      `node_modules`,
      `@hedhog`,
      `${this.module}`,
      'hedhog.yaml',
    );

    const YAMLContent = await loadHedhogFile(hedhogFilePath);

    if (YAMLContent.routes) {
      await writeFile(
        routesYAMLPath,
        YAML.stringify({ routes: YAMLContent.routes }),
        'utf-8',
      );
    } else {
      console.warn(
        `No routes found in the YAML content for module ${this.module}.`,
      );
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
        return await loadHedhogFile(path);
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

  async applyHedhogFile() {
    const spinner = ora('Loading Hedhog file..').start();
    let changeStructure = false;
    this.showDebug('applyHedhogFile', {
      directoryPath: this.directoryPath,
      module: this.module,
    });

    const path = join(
      this.directoryPath,
      'backend',
      'node_modules',
      '@hedhog',
      this.module,
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
          await runScript('prisma:update', join(this.directoryPath, 'backend'));
          spinner.succeed(`Prisma updated.`);
        }
      } catch (error) {
        spinner.fail(error.message);
      }
    } else {
      spinner.info('Hedhog file not found.');
    }
  }

  async updateLibsPrisma() {
    const spinner = ora('Starting updating prisma in libraries...').start();
    const libPath = join(this.directoryPath, 'lib');
    const libsPath = join(this.directoryPath, 'lib', 'libs');

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

  async getModuleDependencies() {
    const packageJsonPath = join(this.nodeModulePath, 'package.json');

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

  async checkDependencies() {
    this.showDebug({
      directoryPath: this.directoryPath,
      module: this.module,
      nodeModulePath: this.nodeModulePath,
    });

    const moduleDependences = await this.getModuleDependencies();
    const packageInstalledModules = this.getPackageInstalledModules(
      this.directoryPath,
      this.module,
    );

    const missingDependences = moduleDependences.filter(
      ([name]: [string, any]) =>
        !packageInstalledModules.find(([moduleName]) => moduleName === name),
    );

    for (const [name] of missingDependences) {
      await this.add(name);
    }
  }

  async complete() {
    console.info();
    console.info(chalk.red(BANNER));
    console.info();
    console.info(MESSAGES.PACKAGE_MANAGER_INSTALLATION_SUCCEED(this.module));
    console.info(MESSAGES.GET_STARTED_INFORMATION);
    if (!this.migrateRun) {
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

  async copyMigrationsFiles() {
    const spinner = ora('Copying migrations files...').start();
    try {
      let copies = 0;
      const migrationsPath = join(
        `${this.nodeModulePath}`,
        `src`,
        `migrations`,
      );
      const entitiesPath = join(`${this.nodeModulePath}`, `src`, `entities`);
      const migrationDestPath = join(
        this.directoryPath,
        `backend`,
        `src`,
        `typeorm`,
        `migrations`,
      );
      await mkdirRecursive(migrationDestPath);
      const entitiesDestPath = join(
        this.directoryPath,
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
              this.directoryPath,
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

  async modifyControllerApp() {
    let alreadyInstalled = false;
    let fileContent = await readFile(this.appControllerPath, 'utf-8');

    if (['@Public()'].includes(fileContent)) {
      return;
    }

    fileContent = await formatTypeScriptCode(fileContent, {
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });

    const importStatement = `import { Public } from '@hedhog/core';`;
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

    await writeFile(this.appControllerPath, updatedFileContent, 'utf-8');
  }

  async modifyAppModule() {
    let alreadyInstalled = false;

    if (['UtilsModule', 'CoreModule'].includes(this.addModuleName)) {
      return;
    }

    let fileContent = await readFile(this.appModulePath, 'utf-8');

    fileContent = await formatTypeScriptCode(fileContent, {
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });

    const importStatement = `import { ${this.addModuleName} } from '${this.packageName}';`;
    if (!fileContent.includes(importStatement)) {
      const importRegex = /(import[\s\S]+?;)/g;
      const importMatch = importRegex.exec(fileContent);
      if (importMatch) {
        const lastImport = importMatch[0];
        fileContent = fileContent.replace(
          lastImport,
          `${lastImport}\n${importStatement}`,
        );
      } else {
        fileContent = `${importStatement}\n\n${fileContent}`;
      }
    } else {
      if (this.showWarning) {
        console.warn(
          chalk.yellow(
            `${EMOJIS.WARNING} The row for "${this.addModuleName}" module already exists.`,
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
      this.nodeModulePath,
      'src',
      `${this.module}.template.ejs`,
    );

    let newModuleTemplate = `${this.addModuleName}`;

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
            `${EMOJIS.WARNING} The "${this.addModuleName}" module is already imported.`,
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

      await writeFile(this.appModulePath, updatedFileContent, 'utf-8');
    } catch (error) {
      console.info(
        chalk.blue('Not possible add module, the original file was restored.'),
      );

      await writeFile(
        this.appModulePath,
        await formatTypeScriptCode(fileContent, {
          singleQuote: true,
          trailingComma: 'all',
          semi: true,
        }),
        'utf-8',
      );
      try {
        await runScript(`format`, join(this.directoryPath, 'backend'));
      } catch (error) {
        console.error(chalk.red('Error formatting file app.module.ts'));
      }
    }

    return true;
  }

  async checkIfModuleExists() {
    const spinner = ora('Checking module installed...').start();
    const path = join(this.nodeModulePath, 'dist', `${this.module}.module.js`);

    try {
      await readFile(path);
      spinner.succeed(`Module ${this.module} installed.`);
      return true;
    } catch (error) {
      spinner.warn(`Module ${this.module} not installed.`);
      return false;
    }
  }

  checkIfDirectoryIsPackage() {
    try {
      const packageJson = require(`${this.directoryPath}/package.json`);

      if (!existsSync(join(this.directoryPath, 'backend'))) {
        throw new Error(
          'Directory is not a hedhog project beacaue backend folder not found.',
        );
      }

      if (!existsSync(join(this.directoryPath, 'admin'))) {
        throw new Error(
          'Directory is not a hedhog project beacaue admin folder not found.',
        );
      }

      if (!packageJson) {
        console.error(chalk.red('This directory is not a package.'));
        return;
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

  /**
   * Installs the package into the given directory. If the package is already installed at the latest version, does nothing.
   * @returns {boolean} True if the package was installed, false if the package was already installed at the latest version.
   */
  async installPackage(): Promise<boolean> {
    if (
      !(await this.checkIfPackageExists(this.directoryPath, this.packageName))
    ) {
      const packageManager = await PackageManagerFactory.find();
      return packageManager.addProduction(
        [this.packageName],
        'latest',
        join(this.directoryPath, 'backend'),
      );
    } else {
      return true;
    }
  }
}
