# Listagem de arquivos `.ts` e `.ejs` do projeto `@hedhog/cli`

## `./actions/abstract.action.ts`

```ts
import { Input } from '../commands';
import { ActionBase } from './action.base';

/**
 * Abstract base class for actions that handle inputs, options, and extra flags.
 * @abstract
 */
export abstract class AbstractAction extends ActionBase {
  /**
   * Handles the action with the specified inputs, options, and extra flags.
   *
   * @param {Input[]} [inputs] - An optional array of inputs for the action.
   * @param {Input[]} [options] - An optional array of options for the action.
   * @param {string[]} [extraFlags] - An optional array of extra flags to modify the behavior of the action.
   * @returns {Promise<{ packagesAdded: string[] } | void>} A promise that resolves with an object containing the packages added or void.
   */
  public abstract handle(
    inputs?: Input[],
    options?: Input[],
    extraFlags?: string[],
  ): Promise<{ packagesAdded: string[] } | void>;
}
```

## `./actions/action.base.ts`

```ts
import chalk = require('chalk');
import { readFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { Input } from '../commands';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { EMOJIS } from '../lib/ui';
import { debug } from '../lib/utils/debug';

/**
 * The base class for all actions in the hedhog CLI.
 * It provides common functionality for handling inputs, options, and extra flags.
 * @abstract
 */
export class ActionBase {
  protected debug = false;
  private envVars: any = false;

  /**
   * Reads the given .env file and parses it into a key-value object.
   * The object is also stored in the `envVars` property of this class.
   * @param envPath The path to the .env file.
   * @returns The parsed key-value object.
   */
  async parseEnvFile(envPath: string) {
    if (this.envVars) {
      return this.envVars;
    }

    if (existsSync(envPath)) {
      let envFile = await readFile(envPath, 'utf-8');
      const envLines = envFile.split('\n');

      const env: any = {};

      // First pass: parse the env file into key-value pairs
      for (const line of envLines) {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key.trim()] = value.trim().replace(/['"\r]+/g, '');
        }
      }

      // Second pass: replace variable references in the values
      for (const key in env) {
        env[key] = env[key].replace(
          /\${(.*?)}/g,
          (_: any, varName: string | number) => env[varName] || '',
        );
      }

      this.envVars = env;
      return env;
    } else {
      console.error(chalk.red(`${EMOJIS.ERROR} File .env not found.`));
    }
  }

  /**
   * Logs debug information to the console if debugging is enabled.
   * Utilizes the `debug` utility function to output the provided arguments.
   * @param args The arguments to be logged as debug information.
   */
  showDebug(...args: any[]) {
    if (this.debug) {
      debug(...args);
    }
  }

  /**
   * Installs the provided dependencies using the specified package manager.
   * Logs information messages when the installation starts and finishes.
   * If the installation fails, logs an error message and exits the process with code 1.
   * @param libraryPath The path to the library where the dependencies should be installed.
   * @param options The options for the install operation.
   * @param dependencies The dependencies to be installed.
   */
  public async installDependencies(
    libraryPath: string,
    options: Input[],
    dependencies: string[],
  ) {
    const inputPackageManager =
      (options.find((option) => option.name === 'packageManager')
        ?.value as string) || 'npm';

    const packageManager: AbstractPackageManager =
      PackageManagerFactory.create(inputPackageManager);

    try {
      console.info(chalk.blue('Installing dependencies...'));
      const currentDir = process.cwd();
      process.chdir(libraryPath);
      await packageManager.addDevelopment(dependencies, 'latest');
      process.chdir(currentDir);

      console.info(chalk.green('Dependencies installed successfully.'));
    } catch (error) {
      console.info(chalk.red('Error installing dependencies:', error));
      process.exit(1);
    }
  }
}
```

## `./actions/add.action.ts`

```ts
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
    this.addModuleName = `${this.capitalizeFirstLetter(this.module).toPascalCase()}Module`;
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

    this.showDebug({
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

    await this.checkDashboardComponents();

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

  async checkDashboardComponents() {
    const path = join(
      this.directoryPath,
      'backend',
      'node_modules',
      '@hedhog',
      this.module,
      'hedhog',
    );
    const extensions = ['json', 'yaml', 'yml'];

    let extension = extensions.find((ext) => {
      return existsSync(`${path}.${ext}`);
    });

    if (!extension) {
      if (!existsSync(path)) {
        return;
      } else {
        extension = 'yaml';
      }
    }

    const filePath = `${path}.${extension}`;

    const hedhogFile = await this.parseHedhogFile(filePath);

    const data = hedhogFile?.data ?? {};
    const components = data?.dashboard_component ?? [];

    this.showDebug({
      path,
      components,
    });

    if (components.length) {
      const dashboardSourcePath = join(
        this.directoryPath,
        'backend',
        'node_modules',
        '@hedhog',
        this.module,
        'frontend',
        'dashboard',
        'components',
      );
      const dashboardDestPath = join(
        this.directoryPath,
        'admin',
        'src',
        'components',
        'dashboard',
      );

      this.showDebug({
        dashboardSourcePath,
        dashboardDestPath,
      });

      await mkdirRecursive(dashboardDestPath);

      for (const component of components) {
        const componentPath = join(
          dashboardSourcePath,
          `${component.slug}.tsx.ejs`,
        );

        this.showDebug({
          component,
          dashboardSourcePath,
          componentPath,
        });

        if (existsSync(componentPath)) {
          const content = await readFile(componentPath, 'utf-8');

          const renderedContent = await formatTypeScriptCode(
            render(content, {
              component,
            }),
          );

          const destFilePath = join(dashboardDestPath, `${component.slug}.tsx`);

          await writeFile(destFilePath, renderedContent, 'utf-8');
        } else {
          console.warn(`Component ${component.slug} not found.`);
        }
      }
    }
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
        routePaths.push(join(routesModulesPath, file));
      }

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

            this.showDebug('tableName', tableName);

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
```

## `./actions/apply.action.ts`

```ts
import chalk = require('chalk');
import { render } from 'ejs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import * as ora from 'ora';
import { AbstractAction } from '.';
import { Input } from '../commands';
import { DTOCreator } from '../lib/classes/DtoCreator';
import { FileCreator } from '../lib/classes/FileCreator';
import { HedhogFile } from '../lib/classes/HedHogFile';
import { TableFactory } from '../lib/classes/TableFactory';
import TemplateProcessor from '../lib/classes/TemplateProcessor';
import { Column } from '../lib/types/column';
import { HedhogTable } from '../lib/types/hedhog-file';
import { Table } from '../lib/types/table';
import { EMOJIS } from '../lib/ui';
import { addRoutesToYaml } from '../lib/utils/add-routes-yaml';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import { toObjectCase } from '../lib/utils/convert-string-cases';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';
import { getConfig } from '../lib/utils/get-config';
import { getRootPath } from '../lib/utils/get-root-path';
import { loadHedhogFile } from '../lib/utils/load-hedhog-file';
import { addPackageJsonPeerDependencies } from '../lib/utils/update-files';
import { writeHedhogFile } from '../lib/utils/write-hedhog-file';

export class ApplyAction extends AbstractAction {
  private libraryName = '';
  private rootPath = '';
  private hedhogFilePath = '';
  private libraryPath = '';
  private librarySrcPath = '';
  private hedhogFile: HedhogFile = new HedhogFile();

  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    this.rootPath = await getRootPath();

    this.hedhogFilePath = join(
      this.rootPath,
      'lib',
      'libs',
      this.libraryName.toKebabCase(),
      'hedhog.yaml',
    );

    this.libraryPath = join(
      this.rootPath,
      'lib',
      'libs',
      this.libraryName.toKebabCase(),
    );

    if (!this.libraryName.length) {
      console.error(chalk.red('You must tell a name for the module.'));
      process.exit(1);
    }

    if (/\s/.test(this.libraryName)) {
      console.error(
        chalk.red('Error: The library name should not contain spaces.'),
      );
      process.exit(1);
    }

    this.librarySrcPath = join(this.libraryPath, 'src');
    this.showDebug(`Library name: ${this.libraryName} (${this.libraryPath})`);
    const tables = await this.parseYamlFile(this.hedhogFilePath);
    this.hedhogFile = await new HedhogFile().load(this.hedhogFilePath);

    this.showDebug(`Tables: `, this.hedhogFile);

    const localeTables: Table[] = [];
    for (const table of this.hedhogFile.getTables()) {
      if (table.name.endsWith('_locale')) {
        localeTables.push(table);
      }
    }

    for (const table of this.hedhogFile.getTables()) {
      this.showDebug(`Processing table: ${table.name}`);

      const tableApply = await TableFactory.create(table, this.hedhogFilePath);
      const screenWithRelations = tableApply.findTableWithRelation();

      const dtoFilePath = join(
        this.librarySrcPath,
        screenWithRelations ? screenWithRelations.toKebabCase() : '',
        table.name.toKebabCase(),
      );

      const hasLocale = tableApply.hasLocale;
      const baseTableName = tableApply.baseName;
      const tablesWithRelations = tableApply.hedhogFile.screensWithRelations;

      if (table.name.endsWith('_locale')) {
        localeTables.push(table);
        continue;
      }

      await this.createTranslationFiles(baseTableName);

      const fields = table.columns
        .filter(
          ({ type }) => !['pk', 'created_at', 'updated_at'].includes(type),
        )
        .filter((field) => field.name !== tableApply.fkName);

      let localeFields: any = [];

      if (hasLocale) {
        const table = localeTables.find((table) => {
          return table.name === `${baseTableName}_locale`;
        }) as Table;

        table.columns.forEach((column: Column) => {
          if (column.locale) localeFields.push(column);
        });
      }

      localeFields = localeFields.map((column: Column) => ({
        name: column.name,
        type: this.mapFieldTypeToInputType(column),
        required: !column.isNullable || false,
      }));

      console.log(localeFields);

      await new DTOCreator(dtoFilePath, fields, hasLocale).createDTOs();

      this.showDebug("DTO's criados com sucesso!");

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'service',
        {
          useLibraryNamePath: true,
          hasRelationsWith: screenWithRelations,
        },
      ).createFile();

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'controller',
        {
          useLibraryNamePath: true,
          hasRelationsWith: screenWithRelations,
        },
      ).createFile();

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'module',
        {
          useLibraryNamePath: true,
          importServices: true,
          hasRelationsWith: screenWithRelations,
          tablesWithRelations,
        },
      ).createFile();

      await this.generateTranslations(
        this.hedhogFile.screens,
        join(this.libraryPath, 'frontend', 'translation', 'modules'),
        (key, value, en, pt) => {
          en[key] = value.title.en;
          pt[key] = value.title.pt;

          if (value.relations) {
            Object.entries(value.relations).forEach(
              ([relationKey, relationValue]) => {
                en[relationKey] = (relationValue as any).title.en;
                pt[relationKey] = (relationValue as any).title.pt;
              },
            );
          }
        },
      );

      await this.generateTranslations(
        this.hedhogFile.tables,
        join(this.libraryPath, 'frontend', 'translation', 'fields'),
        (tableName, table, en, pt) => {
          const localeTable = localeTables?.find(
            (locale) => locale.name === `${tableName}_locale`,
          );

          if (localeTable) {
            table.columns = table.columns.concat(localeTable.columns);
          }

          table.columns.forEach((column: Column) => {
            if (column.locale) {
              const key = `${tableName}.${column.name ?? column.type}`;
              en[key] = column.locale.en;
              pt[key] = column.locale.pt;
            }
          });
        },
      );

      await new FileCreator(
        this.librarySrcPath,
        this.libraryName,
        tableApply,
        'screen',
        {
          localeTables,
        },
      ).createFile();

      await addRoutesToYaml(
        this.librarySrcPath,
        table.name,
        screenWithRelations,
      );

      this.showDebug('Arquivos de rotas criados com sucesso!');

      if (!screenWithRelations) {
        this.showDebug('Updating parent module...');
        await this.updateParentModule(
          this.libraryName,
          join(
            this.librarySrcPath,
            `${this.libraryName.toKebabCase()}.module.ts`,
          ),
          table.name,
        );
        this.showDebug('Parent module updated successfully!');
      }

      this.showDebug('Criando arquivos de frontend...');

      await this.createFrontendFiles(
        table.name,
        table.columns,
        tables,
        tablesWithRelations as any[],
      );

      this.showDebug('Arquivos de frontend criados com sucesso!');
    }

    const dependencyTables = await this.checkRelationsTable(tables);
    await addPackageJsonPeerDependencies(this.libraryName, dependencyTables);
    await this.installDependencies(
      this.libraryPath,
      [{ name: '', value: '' }],
      dependencyTables,
    );

    const hedhogFile2 = await loadHedhogFile(this.hedhogFilePath);

    if (hedhogFile2.screens) {
      const screensArray = Object.keys(hedhogFile2.screens);

      const yamlData = await loadHedhogFile(this.hedhogFilePath);

      yamlData.routes = [];

      const updatedYAML = {
        ...yamlData,
        routes: yamlData.routes,
      } as HedhogFile;

      await writeHedhogFile(this.hedhogFilePath, updatedYAML);

      for (const screen of screensArray) {
        await this.createScreenRouterFile(screen);
      }
    }

    //table-enum.ejs

    this.showDebug('============================================');
    if (hedhogFile2.enums) {
      const enumsArray = Object.keys(hedhogFile2.enums);
      for (const enumName of enumsArray) {
        this.showDebug('Criando enum...', enumName);
        await this.createEnumFile(
          this.libraryPath,
          enumName,
          hedhogFile2.enums[enumName].key,
          hedhogFile2.enums[enumName].value,
          hedhogFile2.data?.[enumName.toSnakeCase()] ?? [],
        );
      }
    }
    this.showDebug('============================================');
  }

  async createEnumFile(
    path: string,
    enumName: string,
    enumKey: string,
    enumValue: string,
    items: any[],
  ) {
    if (!items || !(items instanceof Array)) return;
    const templatePath = join(
      __dirname,
      '..',
      'templates',
      'enum',
      'table-enum.ejs',
    );

    const destinationPath = join(
      path,
      'src',
      enumName.toKebabCase(),
      `${enumName.toKebabCase()}.enum.ts`,
    );

    const values = [];

    let index = 0;
    for (const item of items) {
      values.push({
        key: item[enumKey].toSnakeCase().toUpperCase(),
        value: item[enumValue] ?? ++index,
      });
    }

    let fileContent = render(await readFile(templatePath, 'utf-8'), {
      enumName: enumName.toPascalCase(),
      values,
    });

    fileContent = await formatWithPrettier(fileContent, {
      parser: 'typescript',
      printWidth: 100000,
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
      endOfLine: 'lf',
    });

    await writeFile(
      destinationPath,
      await formatTypeScriptCode(fileContent),
      'utf-8',
    );

    await this.addExportInIndexFile(path, destinationPath);
  }

  async addExportInIndexFile(path: string, destinationPath: string) {
    const indexFilePath = join(path, 'src', 'index.ts');
    const fileContent = await readFile(indexFilePath, 'utf-8');

    const exportStatement = `export * from './${destinationPath.replaceAll('\\', '/').replace(path.replaceAll('\\', '/'), '').replace('/src/', '').replace('.ts', '')}';`;

    if (!fileContent.includes(exportStatement)) {
      await writeFile(
        indexFilePath,
        await formatTypeScriptCode(`${fileContent}\n${exportStatement}`),
        'utf-8',
      );
    }
  }

  async createScreenRouterFile(screen: string) {
    const yamlData = await loadHedhogFile(this.hedhogFilePath);

    if (!yamlData.routes) {
      yamlData.routes = [];
    }

    let moduleRoute = yamlData.routes.find(
      (route: any) => route.path === this.libraryName,
    );

    if (!moduleRoute) {
      moduleRoute = { path: `${this.libraryName}`, children: [] };
      yamlData.routes.push(moduleRoute);
    }

    if (!moduleRoute.children) {
      moduleRoute.children = [];
    }
    moduleRoute.children.push({
      path: screen.toKebabCase(),
      lazy: {
        component: `./pages/${this.libraryName.toKebabCase()}/${screen.toKebabCase()}/index.tsx`,
      },
    });

    await writeHedhogFile(this.hedhogFilePath, {
      ...yamlData,
      routes: yamlData.routes,
    });
  }

  async generateTranslations(
    data: Record<string, any>,
    basePath: string,
    transformFn: (
      key: string,
      value: any,
      en: Record<string, string>,
      pt: Record<string, string>,
    ) => void,
  ) {
    const enTranslations: Record<string, string> = {};
    const ptTranslations: Record<string, string> = {};

    Object.entries(data).forEach(([key, value]) => {
      transformFn(key, value, enTranslations, ptTranslations);
    });

    const enContent = JSON.stringify(enTranslations, null, 2);
    const ptContent = JSON.stringify(ptTranslations, null, 2);

    mkdirSync(basePath, { recursive: true });
    writeFileSync(join(basePath, 'en.json'), enContent, 'utf8');
    writeFileSync(join(basePath, 'pt.json'), ptContent, 'utf8');

    this.showDebug(`Translations generated successfully at: ${basePath}`);
  }

  async screensWithRelations() {
    const hedhogFile = await loadHedhogFile(this.hedhogFilePath);

    const screens = hedhogFile.screens || {};
    return Object.keys(screens)
      .filter((screen) => screens[screen]?.relations)
      .map((screen) => ({
        name: screen,
        relations: screens[screen]?.relations
          ? Object.keys(screens[screen].relations)
          : [],
      }));
  }

  async getOpenIAToken() {
    return await getConfig('tokens.OPENIA');
  }

  async checkRelationsTable(tables: any[]) {
    const relationTables = tables
      .flatMap((table) => table.columns)
      .filter((column) => column.type === 'fk')
      .map((column) => column.references.table)
      .filter((table) => !tables.map((table) => table.name).includes(table));

    const tablesFromLibs = await this.getTablesFromLibs();
    const dependencyModuleNames = new Set<string>();
    for (const relationTable of relationTables) {
      for (const libTables of Object.keys(tablesFromLibs)) {
        if (
          tablesFromLibs[libTables]
            .map((table: any) => table.name)
            .includes(relationTable)
        ) {
          dependencyModuleNames.add(`@hedhog/${libTables}`);
        }
      }
    }

    return Array.from(dependencyModuleNames);
  }

  async getTablesFromLibs() {
    this.showDebug('Getting tables from libs...');
    const tables = {} as any;
    const hedhogLibsPath = join(this.rootPath, 'lib', 'libs');

    for (const folder of await readdir(hedhogLibsPath)) {
      const hedhogFilePath = join(hedhogLibsPath, folder, 'hedhog.yaml');
      if (existsSync(hedhogFilePath)) {
        const hedhogFile = await this.parseYamlFile(hedhogFilePath);
        tables[folder] = hedhogFile;
      }
    }
    return tables;
  }

  async createTranslationFiles(tableName: string) {
    const spinner = ora(`Create translation files...`).start();
    const localesAdminFolder = join(this.rootPath, 'admin', 'src', 'locales');
    const localesFolder = join(
      this.rootPath,
      'lib',
      'libs',
      this.libraryName,
      'frontend',
    );
    const folders = await readdir(localesAdminFolder, { withFileTypes: true });

    for (const folder of folders) {
      if (folder.isDirectory()) {
        spinner.info(`Creating translation file for ${folder.name}...`);

        const folderPath = join(
          localesFolder,
          tableName.toKebabCase(),
          'locales',
          folder.name,
        );

        await mkdirRecursive(folderPath);

        const filePath = join(
          folderPath,
          `${this.libraryName}.${tableName.toKebabCase()}.json`,
        );
        const templatePath = join(
          __dirname,
          '..',
          'templates',
          'translation',
          'translation.json.ejs',
        );
        let fileContent = render(await readFile(templatePath, 'utf-8'), {
          tableName,
          libraryName: this.libraryName,
        });

        const token = await this.getOpenIAToken();

        if (token) {
          spinner.info(`Requesting translation for ${folder.name} with IA...`);

          const assistentId = await getConfig('assistents.applyLocale');
          const response = await this.messageToOpenIaAssistent(
            assistentId,
            `Idioma: ${folder.name} Coisa: ${tableName.replaceAll('_', ' ')}`,
          );
          if (response) {
            fileContent = response;
          }
        }

        await writeFile(
          filePath,
          await formatWithPrettier(fileContent, {
            parser: 'json',
            singleQuote: true,
            trailingComma: 'all',
          }),
          'utf-8',
        );

        spinner.succeed(`Translation file for ${folder.name} created.`);
      }
    }
  }

  async messageToOpenIaAssistent(assistantId: string, content: string) {
    const hash = createHash('sha256').update(content).digest('hex');
    const cacheDirPath = join(
      homedir(),
      '.hedhog',
      'cache',
      `assistant-${assistantId}`,
    );
    const cacheFilePath = join(cacheDirPath, hash);

    if (existsSync(cacheFilePath)) {
      return await readFile(cacheFilePath, 'utf-8');
    }

    const apiKey = await this.getOpenIAToken();
    const client = new OpenAI({
      apiKey,
    });

    try {
      const thread = await client.beta.threads.create({
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      });

      const threadId = thread.id;

      let response = '';

      const run = client.beta.threads.runs
        .stream(threadId, {
          assistant_id: assistantId,
        })
        .on('textDelta', (_delta, snapshot) => {
          response = snapshot.value;
        });
      await run.finalRun();

      await mkdirRecursive(cacheDirPath);
      await writeFile(cacheFilePath, response, 'utf-8');

      return response;
    } catch (e) {
      console.error(chalk.red(`Error sending message to OpenAI: ${e.message}`));
    }
  }

  mapFieldTypeToInputType(field: Column) {
    if (field.field) return `EnumFieldType.${field.field.toUpperCase()}`;
    if (field.type === 'fk' && field.references?.table === 'file') {
      return `EnumFieldType.FILE`;
    }

    switch (field.type) {
      case 'text':
        return `EnumFieldType.RICHTEXT`;
      case 'varchar':
      case 'slug':
        return `EnumFieldType.TEXT`;
      case 'fk':
        return `EnumFieldType.COMBOBOX`;
      case 'date':
        return `EnumFieldType.DATEPICKER`;
      case 'boolean':
        return `EnumFieldType.SWITCH`;
      default:
        return `EnumFieldType.TEXT`;
    }
  }

  getComboboxProperties(field: Column) {
    if (field.type !== 'fk') return;

    const url = `/${String(field.references?.table).toKebabCase()}`;
    const displayName = field.name.replace('_id', '');
    const valueName = field.name.endsWith('id') ? 'id' : 'name';

    return { url, displayName, valueName };
  }

  async createFrontendFiles(
    tableName: string,
    fields: Column[],
    tables: any,
    tablesWithRelations: any[],
  ) {
    const table = this.hedhogFile
      .getTables()
      .find((t) => t.name === tableName) as Table;
    const tableApply = await TableFactory.create(table, this.hedhogFilePath);

    fields = fields
      .filter(
        (field) => !['pk', 'created_at', 'updated_at'].includes(field.type),
      )
      .filter((field) => field.name || field.type === 'slug')
      .map((f) => {
        if (f.type === 'slug') {
          f.name = 'slug';
        }
        return f;
      })
      .map((field) => ({
        ...field,
        inputType: this.mapFieldTypeToInputType(field),
        ...this.getComboboxProperties(field),
      }));

    const frontendPath = join(this.librarySrcPath, '..', 'frontend');
    const extraTabs: any[] = [];
    const extraVariables: any[] = [];
    const extraImportStatements: any[] = [];
    const relatedItems = tablesWithRelations.flatMap((item) => item.name);
    const relationOfItems = tablesWithRelations
      .filter((i) => i.name.includes(relatedItems))
      .flatMap((i) => i.relations);

    if (relatedItems.includes(tableName)) {
      const templateContent = await readFile(
        join(__dirname, '..', 'templates', 'panel', 'tab-panel-item.ts.ejs'),
        'utf-8',
      );

      const relationTables = ((await this.screensWithRelations()) ?? [])
        .map((item: any) => item.relations)
        .flat();

      const processor = new TemplateProcessor(relationTables, this.libraryName);
      const { extraVars, extraImports } = await processor.processAllTables();
      extraVariables.push(...extraVars);
      extraImportStatements.push(...extraImports);

      for (const relatedTable of relationOfItems) {
        const table: Table = tables.find(
          (t: Column) => t.name === relatedTable,
        );

        const mainField = table.columns.find((f) => f.name === 'name') ||
          table.columns.find((f) => f.name === 'title') ||
          table.columns.find((f) => f.type === 'slug') ||
          table.columns.find((f) => f.type === 'varchar') || {
            name: 'id',
            ...table.columns.find((f) => f.type === 'pk'),
          };

        const vars: any = {
          tableNameCase: tableApply.name,
          tableNameRelatedCase: relatedTable,
          fkNameCase: tableApply.fkName,
          pkNameCase: tableApply.pkName,
          hasLocale: tableApply.hasLocale,
          mainField: mainField?.name,
          tableName: relatedTable,
        };

        for (const field in vars) {
          if (typeof vars[field] === 'string' && field.endsWith('Case')) {
            vars[field] = toObjectCase(vars[field]);
          }
        }

        const renderedContent = render(templateContent, vars);
        extraTabs.push(renderedContent);
      }
    }

    const hasRelations = tablesWithRelations.find((t) =>
      t.relations.includes(tableName),
    );

    const tasks = [
      {
        subPath: 'react-query',
        templateSubPath: 'async',
        templates: [
          'requests.ts.ejs',
          'requests-related.ts.ejs',
          'handlers.ts.ejs',
          'handlers-related.ts.ejs',
        ],
        data: {
          tableName,
          tableNameCase: toObjectCase(tableApply.name),
          tableNameRelatedCase: toObjectCase(tableApply.tableNameRelation),
          fkNameCase: toObjectCase(tableApply.fkName),
          pkNameCase: toObjectCase(tableApply.pkName),
          hasLocale: tableApply.hasLocale,
          libraryName: this.libraryName,
          fields,
          hasRelations,
        },
      },
      {
        subPath: 'components',
        templateSubPath: 'panel',
        templates: ['create-panel.ts.ejs', 'update-panel.ts.ejs'],
        data: {
          tableName,
          relationTables: tablesWithRelations.filter(
            (t) => t.name === tableApply.name,
          ).length
            ? relationOfItems.map((i) => toObjectCase(i)).map((i) => i.kebab)
            : [],
          tableNameCase: toObjectCase(tableApply.name),
          tableNameRelatedCase: toObjectCase(tableApply.tableNameRelation),
          fkNameCase: toObjectCase(tableApply.fkName),
          pkNameCase: toObjectCase(tableApply.pkName),
          hasLocale: tableApply.hasLocale,
          libraryName: this.libraryName,
          fields,
          hasRelations,
          extraTabs,
          extraVars: extraVariables.join('\n'),
          extraImports: extraImportStatements.join('\n'),
        },
      },
    ];

    for (const task of tasks) {
      const taskPath = join(
        frontendPath,
        tableName.toKebabCase(),
        task.subPath,
      );

      await mkdir(taskPath, { recursive: true });

      for (const template of task.templates) {
        const isRelatedTemplate = template.endsWith('-related.ts.ejs');
        if ((isRelatedTemplate && hasRelations) || !isRelatedTemplate) {
          const templatePath = join(
            __dirname,
            '..',
            'templates',
            task.templateSubPath,
            template,
          );

          const fileContent = render(
            await readFile(templatePath, 'utf-8'),
            task.data,
          );

          const formattedContent = await formatTypeScriptCode(fileContent);
          const outputFilePath = join(
            taskPath,
            template
              .replace('-related', '')
              .replace(
                '.ts.ejs',
                task.subPath === 'components' ? '.tsx.ejs' : '.ts.ejs',
              ),
          );
          await writeFile(outputFilePath, formattedContent);
        }
      }
    }
  }

  private async parseYamlFile(filePath: string) {
    const data = await loadHedhogFile(filePath);

    this.showDebug(`YAML file parsed: ${filePath}`, data);

    if (data && data.tables) {
      const tables: HedhogTable[] = Object.keys(data.tables).map(
        (tableName) => ({
          name: tableName,
          columns: data.tables?.[tableName]?.columns || [],
          ifNotExists: data.tables?.[tableName].ifNotExists || false,
        }),
      );

      return tables;
    }

    return [];
  }

  private async updateParentModule(
    librayName: string,
    modulePath: string,
    newModuleName: string,
  ) {
    const sameNameModule = librayName === newModuleName;

    if (!modulePath) {
      console.error(chalk.red(`Parent module file not found.`));
      return;
    }

    newModuleName = newModuleName.toPascalCase();

    try {
      let moduleContent = await readFileSync(modulePath, 'utf8');

      moduleContent = await formatWithPrettier(moduleContent, {
        parser: 'typescript',
        printWidth: 100000,
        singleQuote: true,
        trailingComma: 'all',
        semi: true,
      });

      const importStatement = this.createImportStatement(
        newModuleName,
        sameNameModule,
      );
      if (moduleContent.includes(importStatement)) {
        return false;
      }
      moduleContent = `${importStatement}\n${moduleContent}`;

      const { startImportsIndex, endImportsIndex, importsMatch } =
        this.extractImportsSection(moduleContent);

      if (!importsMatch) {
        console.error(
          chalk.red(
            `${EMOJIS.ERROR} "imports" property not found in @Module decorator.`,
          ),
        );
        return;
      }

      const importsList = this.parseImportsList(importsMatch);

      if (sameNameModule) {
        importsList.push(
          `forwardRef(() => ${newModuleName.toPascalCase()}Module2)`,
        );
      } else {
        importsList.push(
          `forwardRef(() => ${newModuleName.toPascalCase()}Module)`,
        );
      }

      const startFileContent = moduleContent.substring(0, startImportsIndex);
      const endFileContent = moduleContent.substring(endImportsIndex - 1);

      const formattedContent = await formatWithPrettier(
        `${startFileContent}${importsList.join(', ')}${endFileContent}`,
        {
          parser: 'typescript',
          singleQuote: true,
          trailingComma: 'all',
          semi: true,
        },
      );
      await writeFile(modulePath, formattedContent, 'utf8');
    } catch (error) {
      console.error(
        chalk.red(`Error updating parent module: ${error.message}`),
      );
    }
  }

  private createImportStatement(
    newModuleName: string,
    sameNameModule = false,
  ): string {
    if (sameNameModule) {
      return `import { ${newModuleName.toPascalCase()}Module as ${newModuleName.toPascalCase()}Module2 } from './${newModuleName.toKebabCase()}/${newModuleName.toKebabCase()}.module';`;
    } else {
      return `import { ${newModuleName.toPascalCase()}Module } from './${newModuleName.toKebabCase()}/${newModuleName.toKebabCase()}.module';`;
    }
  }

  private extractImportsSection(moduleContent: string) {
    const importFind = 'imports: [';
    const startImportsIndex =
      moduleContent.indexOf(importFind) + importFind.length;
    let endImportsIndex = 0;
    let openBracketCount = 1;
    let importsMatch = '';

    for (let i = startImportsIndex; i < moduleContent.length; i++) {
      if (moduleContent[i] === '[') {
        openBracketCount++;
      }

      if (moduleContent[i] === ']') {
        openBracketCount--;
      }

      if (openBracketCount === 0) {
        endImportsIndex = i + 1;
        importsMatch = moduleContent.substring(startImportsIndex, i);
        break;
      }
    }

    return { startImportsIndex, endImportsIndex, importsMatch };
  }

  private parseImportsList(importsMatch: string): string[] {
    const importsList: string[] = [];
    let openBracketCount = 0;
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

    return importsList;
  }
}
```

## `./actions/configure.action.ts`

```ts
import chalk = require('chalk');
import { render } from 'ejs';
import { readFile } from 'fs/promises';
import { createPromptModule } from 'inquirer';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as ora from 'ora';
import { Input } from '../commands';
import { mkdirRecursive } from '../lib/utils/checkVersion';
import { createOpenIAAssistent } from '../lib/utils/create-openia-assistent';
import { dropOpenIAAssistent } from '../lib/utils/drop-openia-assistent';
import { getConfig } from '../lib/utils/get-config';
import { getRootPath } from '../lib/utils/get-root-path';
import { saveConfig } from '../lib/utils/save-config';
import { AbstractAction } from './abstract.action';

export class ConfigureAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.showDebug({
      options,
    });

    let directoryPath = '';

    try {
      directoryPath = await getRootPath();
    } catch (error) {
      return console.error(chalk.red('Directory is not a hedhog project.'));
    }

    this.showDebug({
      directoryPath,
    });

    let openiaToken = '';

    if (options.some((option) => option.name === 'openiaToken')) {
      const openiaOption = options.find(
        (option) => option.name === 'openiaToken',
      );
      if (openiaOption) {
        openiaToken = openiaOption.value as string;
      }
    }

    if (!openiaToken) {
      openiaToken = await this.askForOpenIAToken();
    }

    this.showDebug({
      openiaToken,
    });

    await this.saveConfig(openiaToken);
  }

  getDotHedhogPath() {
    return join(homedir(), '.hedhog');
  }

  getConfigPath() {
    return join(this.getDotHedhogPath(), 'config.yaml');
  }

  async saveConfig(openiaToken: string) {
    const spinner = ora('Saving configuration').start();

    try {
      await this.createDirecotyDotHedhog();

      const assistenteInstructions = render(
        await readFile(
          join(__dirname, '..', 'templates', 'custom', 'assistent.ejs'),
          'utf-8',
        ),
      );

      await saveConfig({ tokens: { OPENIA: openiaToken } });

      const currentAssistentApplyLocaleId = await getConfig(
        'assistents.applyLocale',
      );

      if (currentAssistentApplyLocaleId) {
        try {
          await dropOpenIAAssistent(currentAssistentApplyLocaleId);
        } catch (error) {
          spinner.warn(`Could not drop OpenIA assistent: ${error.message}`);
        }
      }

      try {
        const assistent = await createOpenIAAssistent({
          description: 'Hedhog CLI - Locales',
          instructions: assistenteInstructions,
          name: 'hedhog-cli',
          response_format: {
            type: 'json_object',
          },
          model: 'gpt-4o-mini',
        });

        await saveConfig({ assistents: { applyLocale: assistent.id } });
      } catch (error) {
        console.error(
          chalk.red(`Could not create OpenIA assistent: ${error.message}`),
        );
      }

      spinner.succeed(`Configuration saved to ${this.getConfigPath()}`);
    } catch (error) {
      spinner.fail();
      return console.error(
        chalk.red(`Could not save configuration: ${error.message}`),
      );
    }
  }

  async askForOpenIAToken(): Promise<string> {
    const answer = await createPromptModule({
      output: process.stderr,
      input: process.stdin,
    })({
      type: 'password',
      name: 'token',
      message: `Please enter your OpenIA token:`,
    });

    return answer.token;
  }

  async createDirecotyDotHedhog() {
    const userDirPath = join(homedir(), '.hedhog');

    if (!existsSync(userDirPath)) {
      const spinner = ora('Creating .hedhog directory').start();

      try {
        await mkdirRecursive(userDirPath);
        spinner.succeed();
      } catch (error) {
        spinner.fail();
        return console.error(
          chalk.red(
            'Could not create .hedhog directory in your home directory.',
          ),
        );
      }
    }
  }
}
```

## `./actions/create.action.ts`

```ts
import chalk = require('chalk');
import * as inquirer from 'inquirer';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Input } from '../commands';
import { FileCreator } from '../lib/classes/FileCreator';
import { TableApply } from '../lib/classes/TableApply';
import { createYaml } from '../lib/utils/create-yaml';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';
import { getRootPath } from '../lib/utils/get-root-path';
import {
  updateNestCliJson,
  updatePackageJson,
  updateTsconfigPaths,
} from '../lib/utils/update-files';
import { AbstractAction } from './abstract.action';

export class CreateAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    const libraryName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    ).toLowerCase();

    const removeDefaultDeps =
      Boolean(options.find((i) => i.name === 'remove-default-deps')?.value) ??
      false;
    const force =
      Boolean(options.find((i) => i.name === 'force')?.value) ?? false;

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

    const rootPath = await getRootPath();

    const libraryPath = join(
      rootPath,
      'lib',
      'libs',
      libraryName.toKebabCase(),
    );

    this.showDebug({
      libraryPath,
      libraryName,
      removeDefaultDeps,
      force,
      rootPath,
    });

    await this.checkLibraryExistence(libraryPath, force);
    this.createGitignore(libraryPath);
    await this.createPackageJson(libraryPath, libraryName, removeDefaultDeps);
    await this.createTsconfigProduction(libraryPath);

    new FileCreator(
      libraryPath,
      libraryName,
      { name: libraryName } as TableApply,
      'module',
    ).createFile();
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

    await this.installDependencies(libraryPath, options, [
      '@hedhog/admin',
      '@hedhog/pagination',
      '@hedhog/prisma',
      '@nestjs/mapped-types',
    ]);

    console.info(chalk.green(`Library ${libraryName} created successfully!`));
  }

  private async checkLibraryExistence(libraryPath: string, force: boolean) {
    if (existsSync(libraryPath)) {
      if (force) {
        console.warn(
          chalk.yellow(
            `Warning: Library path ${libraryPath} already exists. Overwriting due to force option.`,
          ),
        );
      } else {
        const answer = await inquirer.createPromptModule({
          output: process.stderr,
          input: process.stdin,
        })({
          type: 'confirm',
          name: 'exists',
          message: `Library path ${libraryPath} already exists. Do you want to overwrite it?`,
        });

        if (!answer.exists) {
          console.info(chalk.red('Aborting library creation...'));
          process.exit(0);
        } else {
          console.info('Overwriting library path...');
        }
      }
    }
  }

  private async createGitignore(libraryPath: string) {
    const gitignoreContent = `
/dist
/node_modules
    `.trim();

    if (!existsSync(libraryPath)) {
      await mkdir(libraryPath, { recursive: true });
    }

    await writeFile(join(libraryPath, '.gitignore'), gitignoreContent);
  }

  private async createPackageJson(
    libraryPath: string,
    libraryName: string,
    removeDefaultDeps: boolean,
  ) {
    const packageJsonContent = {
      name: `@hedhog/${libraryName.toKebabCase()}`,
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
        'frontend/**/*',
        'src/entities/**/*.ts',
        'src/migrations/**/*.ts',
        'src/**/*.ejs',
        'hedhog.yaml',
      ],
      keywords: [],
      author: '',
      license: 'MIT',
      description: '',
      peerDependencies: {},
    };

    if (!removeDefaultDeps) {
      const devDeps = ['@hedhog/admin', '@hedhog/pagination', '@hedhog/prisma'];

      for (const devDep of devDeps) {
        (packageJsonContent as any).peerDependencies[devDep] = 'latest';
      }
    }

    const packageFilePath = join(libraryPath, 'package.json');
    if (!existsSync(libraryPath)) {
      await mkdir(libraryPath, { recursive: true });
    }
    await writeFile(
      packageFilePath,
      JSON.stringify(packageJsonContent, null, 2),
    );
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
      exclude: ['node_modules', 'dist', 'frontend'],
    };

    const tsConfigFilePath = join(libraryPath, 'tsconfig.production.json');

    writeFileSync(
      tsConfigFilePath,
      JSON.stringify(tsconfigProductionContent, null, 2),
    );
  }

  private async createIndexFile(libraryPath: string, libraryName: string) {
    const srcPath = join(libraryPath, 'src');

    if (!existsSync(srcPath)) {
      mkdirSync(srcPath, { recursive: true });
    }

    const indexContent = `
  export * from './${libraryName.toKebabCase()}.module';
    `.trim();

    const indexFilePath = join(srcPath, 'index.ts');
    writeFileSync(
      indexFilePath,
      await formatWithPrettier(indexContent, {
        parser: 'typescript',
      }),
    );
  }
}
```

## `./actions/index.ts`

```ts
export * from './abstract.action';
export * from './add.action';
export * from './apply.action';
export * from './configure.action';
export * from './create.action';
export * from './info.action';
export * from './new.action';
export * from './refresh.action';
export * from './reset.action';
export * from './start.action';
```

## `./actions/info.action.ts`

```ts
import * as chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { join } from 'node:path';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { BANNER, MESSAGES } from '../lib/ui';
import osName from '../lib/utils/os-info.utils';
import { AbstractAction } from './abstract.action';

interface LockfileDependency {
  version: string;
}

interface PackageJsonDependencies {
  [key: string]: LockfileDependency;
}

interface HedHogDependency {
  name: string;
  value: string;
  packageName: string;
}

interface HedHogDependencyWarnings {
  [key: string]: Array<HedHogDependency>;
}

export class InfoAction extends AbstractAction {
  private manager!: AbstractPackageManager;

  private warningMessageDependenciesWhiteList = [
    '@hedhog/admin',
    '@hedhog/pagination',
    '@hedhog/prisma',
  ];

  public async handle() {
    this.manager = await PackageManagerFactory.find();
    this.displayBanner();
    await this.displaySystemInformation();
    await this.displayHedHogInformation();
  }

  private displayBanner() {
    console.info(chalk.red(BANNER));
  }

  private async displaySystemInformation(): Promise<void> {
    console.info(chalk.green('[System Information]'));
    console.info(
      'OS Version     :',
      chalk.blue(osName(platform(), release()), release()),
    );
    console.info('NodeJS Version :', chalk.blue(process.version));
    await this.displayPackageManagerVersion();
  }

  async displayPackageManagerVersion() {
    try {
      const version: string = await this.manager.version();
      console.info(
        `${this.manager.name} Version    :`,
        chalk.blue(version),
        '\n',
      );
    } catch {
      console.error(
        `${this.manager.name} Version    :`,
        chalk.red('Unknown'),
        '\n',
      );
    }
  }

  async displayHedHogInformation(): Promise<void> {
    this.displayCliVersion();
    console.info(chalk.green('[HedHog Platform Information]'));
    await this.displayHedHogInformationFromPackage();
  }

  async displayHedHogInformationFromPackage(): Promise<void> {
    try {
      const dependencies: PackageJsonDependencies =
        this.readProjectPackageDependencies();
      this.displayVersions(dependencies);
    } catch (err) {
      console.error(
        chalk.red(MESSAGES.HEDHOG_INFORMATION_PACKAGE_MANAGER_FAILED),
      );
    }
  }

  displayCliVersion(): void {
    console.info(chalk.green('[HedHog CLI]'));
    console.info(
      'HedHog CLI Version :',
      chalk.blue(
        JSON.parse(readFileSync(join(__dirname, '../package.json')).toString())
          .version,
      ),
      '\n',
    );
  }

  readProjectPackageDependencies(): PackageJsonDependencies {
    const buffer = readFileSync(join(process.cwd(), 'package.json'));
    const pack = JSON.parse(buffer.toString());
    const dependencies = { ...pack.dependencies, ...pack.devDependencies };
    Object.keys(dependencies).forEach((key) => {
      dependencies[key] = {
        version: dependencies[key],
      };
    });
    return dependencies;
  }

  displayVersions(dependencies: PackageJsonDependencies) {
    const _dependencies = this.buildHedhogVersionsMessage(dependencies);
    _dependencies.forEach((dependency) =>
      console.info(dependency.name, chalk.blue(dependency.value)),
    );

    this.displayWarningMessage(_dependencies);
  }

  displayWarningMessage(dependencies: HedHogDependency[]) {
    try {
      const warnings = this.buildHedHogVersionsWarningMessage(dependencies);
      const majorVersions = Object.keys(warnings);
      if (majorVersions.length > 0) {
        console.info('\r');
        console.info(chalk.yellow('[Warnings]'));
        console.info(
          'The following packages are not in the same major version',
        );
        console.info('This could lead to runtime errors');
        majorVersions.forEach((version) => {
          console.info(chalk.bold(`* Under version ${version}`));
          warnings[version].forEach(({ packageName, value }) => {
            console.info(`- ${packageName} ${value}`);
          });
        });
      }
    } catch {
      console.info('\t');
      console.error(
        chalk.red(
          MESSAGES.HEDHOG_INFORMATION_PACKAGE_WARNING_FAILED(
            this.warningMessageDependenciesWhiteList,
          ),
        ),
      );
    }
  }

  buildHedHogVersionsWarningMessage(
    hedHogDependencies: HedHogDependency[],
  ): HedHogDependencyWarnings {
    const unsortedWarnings = hedHogDependencies.reduce(
      (depWarningsGroup, { name, packageName, value }) => {
        if (!this.warningMessageDependenciesWhiteList.includes(packageName)) {
          return depWarningsGroup;
        }

        const [major] = value.replace(/[^\d.]/g, '').split('.', 1);
        const minimumVersion = major;
        depWarningsGroup[minimumVersion] = [
          ...(depWarningsGroup[minimumVersion] || []),
          { name, packageName, value },
        ];

        return depWarningsGroup;
      },
      Object.create(null) as HedHogDependencyWarnings,
    );

    const unsortedMinorVersions = Object.keys(unsortedWarnings);
    if (unsortedMinorVersions.length <= 1) {
      return {};
    }

    const sortedMinorVersions = unsortedMinorVersions.sort(
      (versionA, versionB) => {
        const numA = parseFloat(versionA);
        const numB = parseFloat(versionB);

        if (isNaN(numA) && isNaN(numB)) {
          // If both are not valid numbers, maintain the current order.
          return 0;
        }

        // NaN is considered greater than any number, so if numA is NaN, place it later.
        return isNaN(numA) ? 1 : isNaN(numB) ? -1 : numB - numA;
      },
    );

    return sortedMinorVersions.reduce(
      (warnings, minorVersion) => {
        warnings[minorVersion] = unsortedWarnings[minorVersion];
        return warnings;
      },
      Object.create(null) as HedHogDependencyWarnings,
    );
  }

  buildHedhogVersionsMessage(
    dependencies: PackageJsonDependencies,
  ): HedHogDependency[] {
    const _dependencies = this.collectHedHogDependencies(dependencies);
    return this.format(_dependencies);
  }

  collectHedHogDependencies(
    dependencies: PackageJsonDependencies,
  ): HedHogDependency[] {
    const _dependencies: HedHogDependency[] = [];
    Object.keys(dependencies).forEach((key) => {
      if (key.indexOf('@hedhog') > -1) {
        const depPackagePath = require.resolve(key + '/package.json', {
          paths: [process.cwd()],
        });
        const depPackage = readFileSync(depPackagePath).toString();
        const value = JSON.parse(depPackage).version;
        _dependencies.push({
          name: `${key.replace(/@hedhog\//, '').replace(/@.*/, '')} version`,
          value: value || dependencies[key].version,
          packageName: key,
        });
      }
    });

    return _dependencies;
  }

  format(dependencies: HedHogDependency[]): HedHogDependency[] {
    const sorted = dependencies.sort(
      (dependencyA, dependencyB) =>
        dependencyB.name.length - dependencyA.name.length,
    );
    const length = sorted[0].name.length;
    sorted.forEach((dependency) => {
      if (dependency.name.length < length) {
        dependency.name = this.rightPad(dependency.name, length);
      }
      dependency.name = dependency.name.concat(' :');
      dependency.value = dependency.value.replace(/(\^|\~)/, '');
    });
    return sorted;
  }

  rightPad(name: string, length: number): string {
    while (name.length < length) {
      name = name.concat(' ');
    }
    return name;
  }
}
```

## `./actions/new.action.ts`

```ts
import { rm, writeFile } from 'fs/promises';
import * as inquirer from 'inquirer';
import { clone, init } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { createServer } from 'net';
import * as fs from 'node:fs';
import { join } from 'node:path';
import * as ora from 'ora';
import { Input } from '../commands';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import { Runner, RunnerFactory } from '../lib/runners';
import { BANNER, EMOJIS, MESSAGES } from '../lib/ui';
import { createPrismaSchema } from '../lib/utils/create-prisma-schema';
import { generateRandomString } from '../lib/utils/generate-random-string';
import { runScript } from '../lib/utils/run-script';
import { testDatabaseConnection } from '../lib/utils/test-database-connection';
import { AbstractAction } from './abstract.action';
import { AddAction } from './add.action';
import chalk = require('chalk');

export class NewAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    this.detectLanguage();

    const name = String(
      inputs.find(({ name }) => name === 'name')?.value || 'hedhog',
    );

    const directory = options.find(({ name }) => name === 'directory');
    const directoryPath = `${String(directory?.value) || '.'}/${name}`;
    const backEndDirectoryPath = join(directoryPath, 'backend');
    const adminDirectoryPath = join(directoryPath, 'admin');
    let database = options.find(({ name }) => name === 'database')?.value;
    let dbhost = options.find(({ name }) => name === 'dbhost')?.value;
    let dbport = options.find(({ name }) => name === 'dbport')?.value;
    let dbuser = options.find(({ name }) => name === 'dbuser')?.value;
    let dbpassword = options.find(({ name }) => name === 'dbpassword')?.value;
    let dbname = options.find(({ name }) => name === 'dbname')?.value;
    let dataVolume = options.find(({ name }) => name === 'data-volume')?.value;
    dataVolume = String(dataVolume) || '';
    let dockerCompose = options.some(
      (option) => option.name === 'docker-compose' && option.value === true,
    );
    let force = options.some(
      (option) => option.name === 'force' && option.value === true,
    );
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    const packageManager =
      String(options.find(({ name }) => name === 'packageManager')?.value) ??
      'npm';
    const skipGit =
      Boolean(options.find(({ name }) => name === 'skip-git')?.value) ?? false;
    const skipInstall =
      Boolean(options.find(({ name }) => name === 'skip-install')?.value) ??
      false;
    let docker = !dockerCompose ? 'no' : 'yes';
    let hasDocker = false;

    this.showDebug({
      name,
      directory,
      directoryPath,
      backEndDirectoryPath,
      database,
      dbhost,
      dbport,
      dbuser,
      dbpassword,
      dbname,
      dataVolume,
      dockerCompose,
      force,
      packageManager,
      skipGit,
      skipInstall,
      docker,
      hasDocker,
    });

    if (!(await this.isNestJSCliInstalled())) {
      let packageManager: AbstractPackageManager;

      try {
        packageManager = await PackageManagerFactory.find();
        await packageManager.installGlobal('@nestjs/cli');
      } catch (error) {
        if (error && error.message) {
          console.error(chalk.red(error.message));
        }
      }
    }

    if (!(await this.checkDirectoryIsNotExists(directoryPath))) {
      if (!force) {
        const answerDirectory = await inquirer.createPromptModule({
          output: process.stderr,
          input: process.stdin,
        })({
          type: 'list',
          name: 'clear',
          message: `The directory ${name} is not empty. Do you want to overwrite it?`,
          choices: ['yes', 'no'],
        });

        if (answerDirectory.clear === 'yes') {
          force = true;
        }
      }

      if (force) {
        try {
          await this.removeDirectory(directoryPath);
        } catch (error) {
          process.exit(1);
        }
      } else {
        return console.info(
          chalk.yellow(
            `${EMOJIS.WARNING}  Operation cancelled by user because the directory ${name} is not empty`,
          ),
        );
      }
    }

    await this.cloneRepository(
      'https://github.com/hed-hog/bootstrap.git',
      directoryPath,
    );

    await this.configureGit(directoryPath, skipGit);

    await createPrismaSchema(
      join(backEndDirectoryPath, 'src', 'prisma'),
      database as 'postgres' | 'mysql',
    );

    if (!database) {
      const answerDatabase = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'list',
        name: 'database',
        message: 'Select database type to use in project',
        choices: ['postgres', 'mysql'],
      });

      database = answerDatabase.database;
    }

    if (!dbhost) {
      const answer = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'input',
        name: 'dbhost',
        message: 'Enter database host',
        default: 'localhost',
      });

      dbhost = answer.dbhost;
    }

    if (!dbport) {
      const answer = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'input',
        name: 'dbport',
        message: 'Enter database port',
        default: database === 'postgres' ? 5432 : 3306,
      });

      dbport = answer.dbport;
    }

    if (!dbuser) {
      const answer = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'input',
        name: 'dbuser',
        message: 'Enter database user',
        default: `hedhog`,
      });

      dbuser = answer.dbuser;
    }

    if (!dbpassword) {
      const answer = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'input',
        name: 'dbpassword',
        message: 'Enter database password',
        default: `changeme`,
      });

      dbpassword = answer.dbpassword;
    }

    if (!dbname) {
      const answer = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'input',
        name: 'dbname',
        message: 'Enter database name',
        default: `hedhog`,
      });

      dbname = answer.dbname;
    }

    const spinner = ora('Testing database connection').start();

    let databaseConnection = await testDatabaseConnection(
      database as 'postgres' | 'mysql',
      dbhost as string,
      Number(dbport),
      dbuser as string,
      dbpassword as string,
      dbname as string,
    );

    if (databaseConnection) {
      spinner.succeed('Database connection successful');
    } else {
      spinner.warn('Database connection failed');
    }

    if (!databaseConnection) {
      hasDocker = await this.isDockerInstalled();

      if (hasDocker && !dockerCompose) {
        const answerDocker = await inquirer.createPromptModule({
          output: process.stderr,
          input: process.stdin,
        })({
          type: 'list',
          name: 'docker',
          message: 'Would you like to use docker for create a database?',
          choices: ['yes', 'no'],
        });

        docker = answerDocker.docker;
      }
    }

    if (docker === 'yes') {
      if (!dbport) {
        dbport = database === 'postgres' ? '5432' : '3306';
      }

      dbport = String(await this.findAvailablePort(Number(dbport)));

      await this.createDockerCompose(
        directoryPath,
        database as 'postgres' | 'mysql',
        String(dbuser),
        String(dbpassword),
        String(dbname),
        Number(dbport),
        dataVolume,
      );

      await this.runDockerCompose(directoryPath);

      databaseConnection = await this.retryTestDatabaseConnection(
        database as 'postgres' | 'mysql',
        dbhost as string,
        Number(dbport),
        dbuser as string,
        dbpassword as string,
        dbname as string,
      );
    }

    if (databaseConnection) {
      const migrationTableExists = await this.migrationtableExists(
        database as 'postgres' | 'mysql',
        dbhost as string,
        Number(dbport),
        dbuser as string,
        dbpassword as string,
        dbname as string,
      );

      if (migrationTableExists) {
        ora('').start().warn('Migration table already exists');
      }
    }

    await this.createEnvFile(backEndDirectoryPath, {
      type: database as 'postgres' | 'mysql',
      host: dbhost as string,
      port: Number(dbport),
      user: dbuser as string,
      password: dbpassword as string,
      database: dbname as string,
    });

    await this.updatePrismaProvider(
      database as 'postgres' | 'mysql',
      backEndDirectoryPath,
    );

    await this.updateDatabaseProviderTypeORM(
      database as 'postgres' | 'mysql',
      backEndDirectoryPath,
    );

    if (!skipInstall) {
      await this.installPackages(options, backEndDirectoryPath);
      await this.installPackages(options, adminDirectoryPath);

      process.chdir(backEndDirectoryPath);

      switch (database) {
        case 'postgres':
          await this.installPostgres(options);
          break;
        case 'mysql':
          await this.installMySql(options);
          break;
      }
      process.chdir('../..');
    }

    if (databaseConnection && !skipInstall) {
      await runScript('migrate:up', join(process.cwd(), backEndDirectoryPath));
    }

    this.complete(name, packageManager ?? 'npm', databaseConnection, hasDocker);
  }

  detectLanguage() {
    const language =
      process.env.LANG ||
      process.env.LANGUAGE ||
      process.env.LC_ALL ||
      process.env.LC_MESSAGES;

    if (!language) {
      return 'en-us';
    }

    return language;
  }

  complete(
    directory: string,
    packageManager: string,
    databaseConnection: boolean,
    hasDocker: boolean,
  ) {
    console.info();
    console.info(chalk.red(BANNER));
    console.info();
    console.info(MESSAGES.PACKAGE_MANAGER_INSTALLATION_SUCCEED(directory));
    console.info(MESSAGES.CONFIG_DATABASE);
    console.info(MESSAGES.GET_STARTED_INFORMATION);
    console.info();

    console.info(chalk.gray(MESSAGES.CHANGE_DIR_COMMAND(directory)));

    if (hasDocker && !databaseConnection) {
      console.info(chalk.gray(`$ docker compose up -d --build`));
    }

    console.info(chalk.gray(MESSAGES.START_COMMAND(packageManager)));
    console.info();
  }

  async isNestJSCliInstalled() {
    const nestjs = RunnerFactory.create(Runner.NESTJS);
    try {
      await nestjs?.run('--version', true);
      return true;
    } catch (error) {
      return false;
    }
  }

  async removeDirectory(directory: string) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      console.info();
      console.info(
        chalk.red(
          `${EMOJIS.ERROR} Not possible to remove directory ${chalk.yellow(directory)}`,
        ),
      );
      console.info();
      console.info(
        chalk.gray(
          `${EMOJIS.FIND} Check if you have any application running in this directory as Docker, VSCode, Git or any other`,
        ),
      );
      console.info();
      throw new Error('Directory not empty');
    }
  }

  async checkDirectoryIsNotExists(directory: string) {
    return !fs.existsSync(directory);
  }

  async runDockerCompose(directory: string) {
    const spinner = ora('Running docker-compose').start();
    const docker = RunnerFactory.create(Runner.DOCKER);

    try {
      spinner.info('Creating docker-compose and running');
      await docker?.run('compose up -d --build --quiet-pull', true, directory);
      spinner.succeed(`Docker-compose up and running`);
    } catch (error) {
      spinner.fail('Error running docker-compose');
    }
  }

  getDockerEnvironmentVariables(
    type: 'postgres' | 'mysql',
    username: string,
    password: string,
    databasename: string,
  ) {
    if (type === 'mysql') {
      return `MYSQL_USER: ${username}
      MYSQL_PASSWORD: ${password}
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: ${databasename}`;
    } else {
      return `POSTGRES_USER: ${username}
      POSTGRES_PASSWORD: ${password}
      POSTGRES_DB: ${databasename}`;
    }
  }

  detectIfVolumeIsPath(volume: string) {
    if (!(volume.startsWith('/') || volume.startsWith('.'))) {
      return `volumes:
  ${volume}:
    driver: local`;
    } else {
      return '';
    }
  }

  async createDockerCompose(
    directory: string,
    type: 'postgres' | 'mysql',
    username: string,
    password: string,
    databasename: string,
    databasePort: number,
    dataVolume: string,
  ) {
    const spinner = ora('Creating docker-compose file').start();

    const dockerComposeContent = `services:
  database:
    image: ${type}
    restart: always
    environment:
      ${this.getDockerEnvironmentVariables(type, username, password, databasename)}
    ports:
      - ${databasePort}:${type === 'mysql' ? 3306 : 5432}
    volumes:
      - ${dataVolume}:${type === 'mysql' ? '/var/lib/mysql' : '/var/lib/postgresql/data'}
    healthcheck:
      test: ${type === 'mysql' ? 'mysqladmin ping -h	mysql' : 'pg_isready -U postgres'}
      interval: 10s
      timeout: 5s
      retries: 5
${this.detectIfVolumeIsPath(dataVolume)}`;

    await writeFile(
      join(directory, 'docker-compose.yml'),
      dockerComposeContent,
      'utf-8',
    );

    spinner.succeed(`Docker-compose file created`);
  }

  async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port);
    });
  }

  async findAvailablePort(port: number): Promise<number> {
    return this.isPortAvailable(port).then((available) => {
      if (available) {
        return port;
      } else {
        console.info(
          chalk.yellow(
            `${EMOJIS.WARNING}Port ${port} is not available, trying next port ${port + 1}...`,
          ),
        );
        return this.findAvailablePort(port + 1);
      }
    });
  }

  async isDockerInstalled() {
    const docker = RunnerFactory.create(Runner.DOCKER);
    try {
      await docker?.run('--version', true);
      return true;
    } catch (error) {
      return false;
    }
  }

  async updatePrismaProvider(type: 'postgres' | 'mysql', directory: string) {
    const spinner = ora('Updating Prisma provider').start();
    const prismaSchemaPath = join(directory, 'src', 'prisma', 'schema.prisma');

    let content = await fs.promises.readFile(prismaSchemaPath, 'utf-8');

    content = content.replace(
      /provider = "postgresql"/,
      `provider = "${type === 'postgres' ? 'postgresql' : 'mysql'}"`,
    );

    await fs.promises.writeFile(prismaSchemaPath, content, 'utf-8');

    spinner.succeed();
  }

  async updateDatabaseProviderTypeORM(
    type: 'postgres' | 'mysql',
    directory: string,
  ) {
    const spinner = ora('Updating TypeORM provider').start();
    const ormConfigPath = join(
      directory,
      'src',
      'typeorm',
      'database.providers.ts',
    );

    let content = await fs.promises.readFile(ormConfigPath, 'utf-8');

    content = content.replace(
      /type: 'postgres',/,
      `type: "${type === 'postgres' ? 'postgres' : 'mysql'}",`,
    );

    await fs.promises.writeFile(ormConfigPath, content, 'utf-8');

    spinner.succeed();
  }

  async migrationtableExists(
    type: 'postgres' | 'mysql',
    host: string,
    port: number,
    user: string,
    password: string,
    database: string,
  ) {
    try {
      let query: string;
      switch (type) {
        case 'postgres':
          const { Client } = await import('pg');
          const client = new Client({
            user,
            host,
            database,
            password,
            port,
          });
          await client.connect();
          query = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`;
          const res = await client.query(query, ['migrations']);
          await client.end();
          return res.rowCount === 1;
        case 'mysql':
          const mysql = await import('mysql2/promise');
          const connection = await mysql.createConnection({
            user,
            host,
            database,
            password,
            port,
          });
          query = `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`;
          const result = await connection.query(query, [
            database,
            'migrations',
          ]);
          await connection.end();
          return (result as any)[0].length === 1;
      }
    } catch (error) {
      console.error(chalk.red(error.message));
      return false;
    }
  }

  async retryTestDatabaseConnection(
    type: 'postgres' | 'mysql',
    host: string,
    port: number,
    user: string,
    password: string,
    database: string,
    retries = 24,
    interval = 5000,
  ) {
    const spinner = ora('Testing database connection').start();
    let retry = 0;

    while (retry < retries) {
      const result = await testDatabaseConnection(
        type,
        host,
        port,
        user,
        password,
        database,
      );

      if (result) {
        spinner.succeed(
          `Database connection successful after ${retry} retries`,
        );
        return true;
      } else {
        retry++;
        spinner.start(`Testing database connection. Retry ${retry}/${retries}`);
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }

    spinner.fail(`Database connection failed after ${retries} retries.`);

    return false;
  }

  async add(module: string) {
    const action = new AddAction();
    return action.handle(
      [{ name: 'module', value: module }],
      [{ name: 'silentComplete', value: true }],
    );
  }

  async installMySql(options: Input[]) {
    const inputPackageManager = options.find(
      (option) => option.name === 'packageManager',
    )!.value as string;

    let packageManager: AbstractPackageManager;

    try {
      packageManager = PackageManagerFactory.create(inputPackageManager);
      return packageManager.addProduction(['mysql2'], 'latest');
    } catch (error) {
      if (error && error.message) {
        console.error(chalk.red(error.message));
      }
    }
  }

  async installPostgres(options: Input[]) {
    const inputPackageManager = options.find(
      (option) => option.name === 'packageManager',
    )!.value as string;

    let packageManager: AbstractPackageManager;

    try {
      packageManager = PackageManagerFactory.create(inputPackageManager);
      return packageManager.addProduction(['pg'], 'latest');
    } catch (error) {
      if (error && error.message) {
        console.error(chalk.red(error.message));
      }
    }
  }

  async installPackages(options: Input[], directory: string) {
    const inputPackageManager = options.find(
      (option) => option.name === 'packageManager',
    )!.value as string;

    let packageManager: AbstractPackageManager;

    try {
      packageManager = PackageManagerFactory.create(inputPackageManager);
      return packageManager.install(directory, inputPackageManager);
    } catch (error) {
      if (error && error.message) {
        console.error(chalk.red(error.message));
      }
    }
  }

  async cloneRepository(url: string, directory: string) {
    const spinner = ora('Cloning repository').start();
    const result = await clone({
      url,
      dir: directory,
      fs,
      http,
    });
    spinner.succeed();
    return result;
  }

  async deleteGitFolder(directory: string) {
    const MAX_ATTEMPTS = 3;
    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
      try {
        await fs.promises.rm(`${directory}/.git`, { recursive: true });
        break; // Se a remoção for bem-sucedida, saia do loop
      } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM') {
          console.warn(
            `Attempt ${attempt + 1} failed: resource busy or locked.`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Espera 1 segundo antes de tentar novamente
          attempt++;
        } else {
          throw err; // Se o erro não for 'EBUSY', lançar o erro novamente
        }
      }
    }

    if (attempt === MAX_ATTEMPTS) {
      throw new Error('Failed to remove .git folder after multiple attempts');
    }
  }

  async configureGit(directory: string, skipGit: boolean = false) {
    const results = [];
    const spinner = ora('Configure git in project folder').start();
    await this.deleteGitFolder(directory); // Use a função para remover a pasta .git
    if (!skipGit) {
      results.push(await init({ dir: directory, fs }));
    }
    spinner.succeed();
    return results;
  }

  async createEnvFile(
    dirPath: string,
    config: {
      type: 'postgres' | 'mysql';
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    },
  ) {
    const spinner = ora('Creating .env file').start();
    const secret = generateRandomString(32);

    const envContent = `
DB_HOST="${config.host}"
DB_PORT="${config.port}"
DB_USERNAME="${config.user}"
DB_PASSWORD="${config.password}"
DB_DATABASE="${config.database}"

DATABASE_URL="${config.type === 'postgres' ? 'postgresql' : 'mysql'}://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_DATABASE}"

JWT_SECRET="${secret}"
JWT_EXPIRES_IN="7d"
    `;

    const envFilePath = join(dirPath, '.env');

    const result = await fs.promises.writeFile(
      envFilePath,
      envContent.trim(),
      'utf-8',
    );
    spinner.succeed();
    return result;
  }
}
```

## `./actions/refresh.action.ts`

```ts
import chalk = require('chalk');
import { execSync } from 'child_process';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { Input } from '../commands';
import { formatWithPrettier } from '../lib/utils/format-with-prettier';
import { AbstractAction } from './abstract.action';

export class RefreshAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const dependencyName = String(
      inputs.find(({ name }) => name === 'name')?.value,
    );

    if (!dependencyName.length) {
      console.error(chalk.red('You must provide a dependency name.'));
      process.exit(1);
    }

    const packageJsonPath = join(process.cwd(), 'package.json');
    const appModulePath = join(process.cwd(), 'src/app.module.ts');
    const packageLockPath = join(process.cwd(), 'package-lock.json');
    const migrationsPath = join(process.cwd(), 'src/typeorm/migrations');

    if (!fs.existsSync(packageJsonPath)) {
      console.error(chalk.red('package.json not found.'));
      process.exit(1);
    }

    this.deleteMigrationsFiles(migrationsPath);
    await this.updatePackageJson(packageJsonPath);
    await this.updateAppModule(appModulePath);
    await this.deletePackageLock(packageLockPath);
    await this.addDependency(dependencyName);
  }

  private deleteMigrationsFiles(migrationsPath: string) {
    if (fs.existsSync(migrationsPath)) {
      const files = fs.readdirSync(migrationsPath);
      for (const file of files) {
        const filePath = join(migrationsPath, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          console.info(`Deleted file: ${filePath}`);
        }
      }
    } else {
      console.error(`Folder not found: ${migrationsPath}`);
    }
  }

  private async updatePackageJson(packageJsonPath: string) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const removeHedhogDeps = (deps: { [key: string]: string } | undefined) => {
      if (!deps) return;
      for (const key of Object.keys(deps)) {
        if (
          key.startsWith('@hedhog') &&
          key !== '@hedhog/prisma' &&
          key !== '@hedhog/utils' &&
          key !== '@hedhog/core'
        ) {
          delete deps[key];
        }
      }
    };

    removeHedhogDeps(packageJson.peerDependencies);
    removeHedhogDeps(packageJson.devDependencies);
    removeHedhogDeps(packageJson.dependencies);

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    await formatWithPrettier(packageJsonPath, {
      parser: 'json',
    });

    console.info(
      chalk.blue(
        'Updated package.json and removed @hedhog dependencies (except @hedhog/prisma).',
      ),
    );
  }

  private async updateAppModule(appModulePath: string) {
    if (!fs.existsSync(appModulePath)) {
      console.error(chalk.red('src/app.module.ts not found.'));
      return null;
    }
    const fileContent = fs.readFileSync(appModulePath, 'utf8');

    const updatedContent = fileContent
      .replace(/imports:\s*\[([^\]]+)\]/, `imports: [PrismaModule]`)
      .replace(/import\s*{[^}]*}\s*from\s*'@hedhog\/(?!prisma)[^']*';\n?/g, '');

    fs.writeFileSync(appModulePath, updatedContent, 'utf8');

    console.info(
      chalk.blue(
        'Updated app.module.ts and removed @hedhog modules (except PrismaModule).',
      ),
    );
  }

  private async deletePackageLock(packageLockPath: string) {
    if (fs.existsSync(packageLockPath)) {
      fs.unlinkSync(packageLockPath);
      console.info(chalk.blue('Deleted package-lock.json.'));
    } else {
      console.warn(
        chalk.yellow('package-lock.json not found, skipping deletion.'),
      );
    }
  }

  private async addDependency(dependencyName: string) {
    try {
      console.info(chalk.blue(`Adding dependency ${dependencyName}...`));
      execSync(`hedhog add ${dependencyName}`, { stdio: 'inherit' });
      console.info(chalk.green(`Successfully added ${dependencyName}.`));
    } catch (error) {
      console.error(
        chalk.red(`Failed to add ${dependencyName}: ${error.message}`),
      );
      process.exit(1);
    }
  }
}
```

## `./actions/reset.action.ts`

```ts
import chalk = require('chalk');
import { render, renderFile } from 'ejs';
import { lstat, mkdir, readdir, rmdir, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ora from 'ora';
import { createPrismaSchema } from '../lib/utils/create-prisma-schema';
import { getEnvFileTemplate } from '../lib/utils/env-file-template';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import { getFileContent } from '../lib/utils/get-file-content';
import { getRootPath } from '../lib/utils/get-root-path';
import { recreateDatabase } from '../lib/utils/recreate-database';
import { testDatabaseConnection } from '../lib/utils/test-database-connection';
import { AbstractAction } from './abstract.action';

export class ResetAction extends AbstractAction {
  public async handle() {
    console.info(chalk.yellow('Resetting the project...'));
    let directoryPath = '';
    let libPath = '';
    let backendPath = '';

    try {
      directoryPath = await getRootPath();
      libPath = join(directoryPath, 'lib');
      backendPath = join(directoryPath, 'backend');
    } catch (error) {
      return console.error(chalk.red('Directory is not a hedhog project.'));
    }

    await this.removeDependencies(backendPath);
    await this.recreateAppModule(backendPath);
    await this.recreatePrismaSchema(backendPath);
    await this.checkEnvFile(backendPath);
    await this.recreateDatabase(backendPath);
    await this.resetAdminFrontEnd(backendPath);
    await this.resetLocalStorageFiles(libPath);
    await this.resetAdminRoutes(directoryPath);
    await this.resetDashboardComponents(directoryPath);

    console.info(chalk.green('Project reset successfully.'));
  }

  async resetDashboardComponents(path: string) {
    const spinner = ora('Reset Dashboard Components...').start();

    const componentsPath = join(
      path,
      'admin',
      'src',
      'components',
      'dashboard',
    );

    for (const file of await readdir(componentsPath)) {
      const filePath = join(componentsPath, file);
      if (existsSync(filePath)) {
        try {
          await unlink(filePath);
          spinner.info(`Deleted ${file}...`);
        } catch (error) {
          spinner.fail(`Failed to delete ${file}.`);
        }
      }
    }

    spinner.succeed('Dashboard components reseted.');
  }

  async resetAdminRoutes(path: string) {
    const spinner = ora('Reset Admin Routes...').start();

    const routerTemplatePath = join(
      __dirname,
      '..',
      'templates',
      'route',
      'router.tsx.ejs',
    );

    if (!routerTemplatePath) {
      spinner.fail('No Admin Routes found.');
      return;
    }

    const templateContent = await readFile(routerTemplatePath, 'utf-8');
    const routerDestPath = join(path, 'admin', 'src', 'router.tsx');

    if (!existsSync(routerDestPath)) {
      spinner.fail('No Admin Routes found.');
      return;
    }

    const renderedContent = await formatTypeScriptCode(
      render(templateContent, {
        routes: [],
      }),
    );

    await writeFile(routerDestPath, renderedContent, 'utf-8');

    spinner.succeed('Admin Routes reseted.');
  }

  async resetAdminFrontEnd(path: string) {
    const spinner = ora('Reset Admin Frontend...').start();
    const adminPath = join(path, '..', 'admin');

    if (
      existsSync(adminPath) &&
      existsSync(join(adminPath, 'src', 'routes', 'modules'))
    ) {
      const moduleRouteFiles = await readdir(
        join(adminPath, 'src', 'routes', 'modules'),
      );

      const modules = moduleRouteFiles.map((file) => file.replace('.yaml', ''));

      for (const module of modules) {
        for (const dir of ['pages', 'features']) {
          spinner.info(`Clearing ${dir}/${module}...`);
          this.unlinkDirectoryRecursive(join(adminPath, 'src', dir, module));
        }

        for (const locale of ['en', 'pt']) {
          const localePath = join(adminPath, 'src', 'locales', locale);
          if (existsSync(localePath)) {
            const localeFiles = await readdir(localePath);
            for (const file of localeFiles) {
              if (
                modules.some((module) => file.includes(module)) ||
                ['fields', 'modules'].some((keyword) => file.includes(keyword))
              ) {
                spinner.info(`Deleting locales/${locale}/${file}...`);
                await unlink(join(localePath, file));
              }
            }
          }
        }
      }

      const routerTemplatePath = join(
        __dirname,
        '..',
        'templates',
        'route',
        'router.tsx.ejs',
      );

      const routerContent = await renderFile(routerTemplatePath, {
        routes: [],
      });

      await writeFile(
        join(adminPath, 'src', 'router.tsx'),
        routerContent,
        'utf-8',
      );

      spinner.succeed('Router template set as default.');

      const moduleRoutesPath = join(adminPath, 'src', 'routes', 'modules');
      if (existsSync(moduleRoutesPath)) {
        spinner.info('Clearing routes/modules...');
        this.unlinkDirectoryRecursive(moduleRoutesPath);
      }

      spinner.succeed('Admin Frontend cleared.');
    } else {
      spinner.warn('No Admin Frontend found.');
    }
  }

  async resetLocalStorageFiles(path: string) {
    const spinner = ora('Reset Local Storage Files...').start();
    const storagePath = join(path, 'storage');

    if (existsSync(storagePath)) {
      await this.unlinkDirectoryRecursive(storagePath);
      await mkdir(storagePath, { recursive: true });
      spinner.succeed('Local storage files cleared.');
    } else {
      spinner.warn('No Local storage files found.');
    }
  }

  async checkEnvFile(path: string) {
    const spinner = ora('Check .env file...').start();
    const envPath = join(path, '.env');

    if (!existsSync(envPath)) {
      await writeFile(envPath, getEnvFileTemplate(), 'utf-8');
      spinner.succeed('Environment file created.');
    } else {
      spinner.succeed('Environment file found.');
    }
  }

  async unlinkDirectoryRecursive(path: string) {
    if (existsSync(path)) {
      const files = await readdir(path);

      for (const file of files) {
        const currentPath = join(path, file);

        try {
          if (
            existsSync(currentPath) &&
            (await lstat(currentPath)).isDirectory()
          ) {
            await this.unlinkDirectoryRecursive(currentPath);
          } else {
            if (existsSync(currentPath)) {
              await unlink(currentPath);
            }
          }
        } catch (error) {
          return false;
        }
      }

      await rmdir(path);

      return true;
    } else {
      return false;
    }
  }

  async recreatePrismaSchema(path: string) {
    const spinner = ora('Recreate Prisma Schema').start();
    try {
      const envVars = await this.parseEnvFile(join(path, '.env'));

      const database = String(envVars.DATABASE_URL).split(':')[0] as
        | 'postgres'
        | 'mysql';

      await createPrismaSchema(
        join(path, 'src', 'prisma'),
        database === 'mysql' ? 'mysql' : 'postgres',
      );
      spinner.succeed('Prisma Schema created.');
    } catch (error) {
      spinner.fail('Failed to recreate Prisma Schema.');
      console.error(error);
    }
  }

  async recreateAppModule(path: string) {
    const spinner = ora('Recreate app.module.ts...').start();
    try {
      const appModulePath = join(path, 'src', 'app.module.ts');

      if (existsSync(appModulePath)) {
        await unlink(appModulePath);
      }

      const bootstrapContent = await getFileContent(
        'https://raw.githubusercontent.com/hed-hog/bootstrap/refs/heads/master/backend/src/app.module.ts',
      );

      await writeFile(appModulePath, bootstrapContent, 'utf-8');
      spinner.succeed('AppModule created.');
    } catch (error) {
      spinner.fail('Failed to recreate app.module.ts.');
      console.error(error);
    }
  }

  async removeMigrations(path: string) {
    const spinner = ora('Remove migrations...').start();
    const migrationsPath = join(path, `src`, `typeorm`, `migrations`);

    if (existsSync(migrationsPath)) {
      await this.unlinkDirectoryRecursive(migrationsPath);
      spinner.succeed('Migrations cleared.');
      await mkdir(migrationsPath, { recursive: true });
    } else {
      spinner.warn('No migrations found.');
    }
  }

  async removeDependencies(path: string) {
    const spinner = ora('Remove dependencies...').start();
    const packageJsonPath = join(path, 'package.json');

    const hedhogDependencies = [];
    const excludedDependencies = [
      '@hedhog/prisma',
      '@hedhog/utils',
      '@hedhog/core',
    ];

    if (existsSync(packageJsonPath)) {
      const packageJson = require(packageJsonPath);

      for (const dep in packageJson.dependencies) {
        if (dep.includes('@hedhog') && !excludedDependencies.includes(dep)) {
          hedhogDependencies.push(dep);
        }
      }

      if (hedhogDependencies.length > 0) {
        hedhogDependencies.forEach(async (dep) => {
          delete packageJson.dependencies[dep];
        });

        await writeFile(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2),
          'utf-8',
        );

        spinner.succeed('Dependencies cleared.');
      } else {
        spinner.warn('No HedHog dependencies found.');
      }
    } else {
      spinner.warn('No package.json found.');
    }
  }

  async recreateDatabase(path: string) {
    const spinner = ora('Start recreating database...').start();
    const envVars = await this.parseEnvFile(join(path, '.env'));

    if (
      envVars.DATABASE_URL &&
      envVars.DB_HOST &&
      envVars.DB_PORT &&
      envVars.DB_USERNAME &&
      envVars.DB_PASSWORD &&
      envVars.DB_DATABASE
    ) {
      const type = envVars.DATABASE_URL.split(':')[0] as 'postgres' | 'mysql';

      const isDbConnected = await testDatabaseConnection(
        type,
        envVars.DB_HOST,
        Number(envVars.DB_PORT),
        envVars.DB_USERNAME,
        envVars.DB_PASSWORD,
        envVars.DB_DATABASE,
      );

      if (isDbConnected) {
        spinner.info('Recreating database...');
        await recreateDatabase(
          type,
          envVars.DB_HOST,
          Number(envVars.DB_PORT),
          envVars.DB_USERNAME,
          envVars.DB_PASSWORD,
          envVars.DB_DATABASE,
        );
        spinner.succeed('Database recreated.');
      } else {
        spinner.fail('Failed to connect to the database.');
      }
    }
  }
}
```

## `./actions/start.action.ts`

```ts
import { spawn } from 'child_process';
import * as net from 'net';
import { join } from 'node:path';
import * as ora from 'ora';
import { EMOJIS } from '../lib/ui';
import { getRootPath } from '../lib/utils/get-root-path';
import { AbstractAction } from './abstract.action';
import chalk = require('chalk');

export class StartAction extends AbstractAction {
  private spinner: ora.Ora = ora();

  public async handle() {
    this.spinner = ora(`Starting HedHog ${EMOJIS.HEDGEHOG}...`).start();

    const rootPath = await getRootPath();
    await this.startProcess(
      'API',
      'npm',
      ['run', 'dev'],
      join(rootPath, 'backend'),
    );
    await this.startProcess(
      'ADM',
      'npm',
      ['run', 'dev'],
      join(rootPath, 'admin'),
    );
    await this.waitForPorts();
  }

  async startProcess(id: string, bin: string, args: string[], cwd: string) {
    this.spinner.info(`Starting ${bin} ${args.join(' ')} in ${cwd}`);
    const childProcess = spawn(bin, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    childProcess.stderr?.on('data', (data) => {
      this.spinner.fail(`${id}: ${data.toString()}`);
    });

    childProcess.stdout?.on('data', (data) => {
      this.spinner.info(`${id}: ${data.toString()}`);
    });

    return childProcess;
  }

  async waitForPorts() {
    let apiReady = false;
    let frontendReady = false;

    this.spinner.info('Waiting for ports to be ready...');

    while (!apiReady || !frontendReady) {
      apiReady = await this.checkPort(3000);
      frontendReady = await this.checkPort(3100);

      if (!apiReady || !frontendReady) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    this.complete();
  }

  complete() {
    this.spinner.succeed();
    console.clear();
    console.info();
    console.info(
      chalk.rgb(255, 118, 12)(`${EMOJIS.HEDGEHOG} HedHog is ready!`),
    );
    console.info();
    console.info(
      chalk.green('➡ '),
      `API:`,
      chalk.cyan('http://localhost:3000'),
    );
    console.info(
      chalk.green('➡ '),
      `ADMIN:`,
      chalk.cyan('http://localhost:3100'),
    );
    console.info();
  }

  async checkPort(port: number, host = 'localhost') {
    return new Promise<boolean>((resolve, reject) => {
      try {
        const client = net.connect({ port, host }, () => {
          client.end();
          resolve(true);
        });

        client.on('error', () => {
          resolve(false);
        });
      } catch (error) {
        this.spinner.fail(`Error: ${error}`);
        reject(error);
      }
    });
  }
}
```

## `./actions/validate.action.ts`

```ts
import { existsSync } from 'fs';
import { join } from 'path';
import { Input } from '../commands';
import { getRootPath } from '../lib/utils/get-root-path';
import { loadHedhogFile } from '../lib/utils/load-hedhog-file';
import { AbstractAction } from './abstract.action';
import chalk = require('chalk');

export class ValidateAction extends AbstractAction {
  private rootPath = '';
  private module = '';
  private modulePath = '';

  public async handle(inputs: Input[], options: Input[]) {
    this.debug = options.some(
      (option) => option.name === 'debug' && option.value === true,
    );

    this.module = String(
      inputs.find((input) => input.name === 'module')?.value || '',
    ).toLowerCase();

    this.rootPath = await getRootPath();
    this.modulePath = join(this.rootPath, 'lib', 'libs', this.module);

    if (!existsSync(this.modulePath)) {
      console.error(chalk.red(`Module ${this.module} not found.`));
      return;
    }

    this.showDebug('ValidateAction', {
      inputs,
      options,
      rootPath: this.rootPath,
      module: this.module,
      modulePath: this.modulePath,
    });

    const hedhogFile = await loadHedhogFile(this.modulePath);

    this.showDebug('HedhogFile', hedhogFile);

    console.info(chalk.gray('-----------------------------------------'));

    Object.keys(hedhogFile.tables ?? {}).forEach((table) => {
      console.info('Table:', chalk.yellow(table));
      console.info('Content', (hedhogFile.tables ?? {})[table]);
      console.info(chalk.gray('-----------------------------------------'));
    });

    Object.keys(hedhogFile.data ?? {}).forEach((data) => {
      console.info('Data:', chalk.yellow(data));
      console.info('Content', (hedhogFile.data ?? {})[data]);
      console.info(chalk.gray('-----------------------------------------'));
    });

    Object.keys(hedhogFile.screens ?? {}).forEach((screen) => {
      console.info('Screen:', chalk.yellow(screen));
      console.info('Content', (hedhogFile.screens ?? {})[screen]);
      console.info(chalk.gray('-----------------------------------------'));
    });

    console.info('Routes:', hedhogFile.routes);
    console.info(chalk.gray('-----------------------------------------'));

    Object.keys(hedhogFile.enums ?? {}).forEach((enumName) => {
      console.info('Enum:', chalk.yellow(enumName));
      console.info('Content', (hedhogFile.enums ?? {})[enumName]);
      console.info(chalk.gray('-----------------------------------------'));
    });
  }
}
```

## `./bin/hedhog.ts`

```ts
#!/usr/bin/env node

import { Command } from '@commander-js/extra-typings';
import 'reflect-metadata';
import { CommandLoader } from '../commands';
import { checkVersion } from '../lib/utils/checkVersion';
import '../lib/utils/global-string';
import {
  loadLocalBinCommandLoader,
  localBinExists,
} from '../lib/utils/local-binaries';

const bootstrap = async () => {
  const debug = true;

  await checkVersion();

  const program = new Command();

  program
    .version(
      require('../package.json').version,
      '-v, --version',
      'Output the current version.',
    )
    .usage('<command> [options]')
    .helpOption('-h, --help', 'Output usage information.');

  if (!debug && localBinExists()) {
    const localCommandLoader = loadLocalBinCommandLoader();
    await localCommandLoader.load(program);
  } else {
    await CommandLoader.load(program);
  }

  await program.parseAsync(process.argv);

  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
};

bootstrap();
```

## `./commands/abstract.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractAction } from '../actions/abstract.action';

export abstract class AbstractCommand {
  constructor(protected action: AbstractAction) { }

  public abstract load(program: Command): void;
}
```

## `./commands/add.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class AddCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('add')
      .argument('<string>', 'module name')
      .option('--silent-complete', 'Skip completion message.', false)
      .option('--debug', 'Show debug information.', false)
      .description('Adds support for an external module to your project.')
      .usage('<module> [options]')
      .action(async (module, command) => {
        const options: Input[] = [];

        options.push({ name: 'silentComplete', value: command.silentComplete });
        options.push({
          name: 'debug',
          value: command.debug,
        });
        const inputs: Input[] = [];
        inputs.push({ name: 'module', value: module });
        this.action.handle(inputs, options);
      });
  }
}
```

## `./commands/apply.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { throwError } from '../lib/utils/throw-error';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ApplyCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('apply')
      .description(
        'Transform the Hedhog YAML file into inserts on database and init the new Hedhog library.',
      )
      .option('--debug', 'Show debug information.', false)
      .argument('<string>', 'library name')
      .action(async (name, command) => {
        try {
          if (!name) {
            throw new Error('Library name is required');
          }

          const options: Input[] = [];
          options.push({
            name: 'debug',
            value: command.debug,
          });

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });
          await this.action.handle(inputs, options);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
```

## `./commands/command.input.ts`

```ts
export interface Input {
  name: string;
  value: boolean | string | string[];
  options?: any;
}
```

## `./commands/command.loader.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import * as chalk from 'chalk';
import {
  AddAction,
  ConfigureAction,
  CreateAction,
  InfoAction,
  NewAction,
} from '../actions';
import { ApplyAction } from '../actions/apply.action';
import { RefreshAction } from '../actions/refresh.action';
import { ResetAction } from '../actions/reset.action';
import { StartAction } from '../actions/start.action';
import { ValidateAction } from '../actions/validate.action';
import { ERROR_PREFIX } from '../lib/ui';
import { AddCommand } from './add.command';
import { ApplyCommand } from './apply.command';
import { ConfigureCommand } from './configure.command';
import { CreateCommand } from './create.command';
import { InfoCommand } from './info.command';
import { NewCommand } from './new.command';
import { RefreshCommand } from './refresh.command';
import { ResetCommand } from './reset.command';
import { StartCommand } from './start.command';
import { ValidateCommand } from './validate.command';

export class CommandLoader {
  public static async load(program: Command): Promise<void> {
    new NewCommand(new NewAction()).load(program);
    new CreateCommand(new CreateAction()).load(program);
    new AddCommand(new AddAction()).load(program);
    new InfoCommand(new InfoAction()).load(program);
    new StartCommand(new StartAction()).load(program);
    new RefreshCommand(new RefreshAction()).load(program);
    new ResetCommand(new ResetAction()).load(program);
    new ApplyCommand(new ApplyAction()).load(program);
    new ConfigureCommand(new ConfigureAction()).load(program);
    new ValidateCommand(new ValidateAction()).load(program);

    this.handleInvalidCommand(program);
  }

  private static handleInvalidCommand(program: Command) {
    program.on('command:*', () => {
      console.error(
        `\n${ERROR_PREFIX} Invalid command: ${chalk.red('%s')}`,
        program.args.join(' '),
      );
      console.info(
        `See ${chalk.red('--help')} for a list of available commands.\n`,
      );
      process.exit(1);
    });
  }
}
```

## `./commands/configure.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ConfigureCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('configure')
      .option('--debug', 'Show debug information.', false)
      .option('--openia-token <openiaToken>', 'OpenIA token.', '')
      .description('Configures the hedhog CLI.')
      .usage('[options]')
      .action(async (opts: Record<string, any>, _command: Command) => {
        const options: Input[] = [];

        options.push({ name: 'debug', value: Boolean(opts.debug) });

        options.push({ name: 'openiaToken', value: opts?.openiaToken ?? '' });

        const inputs: Input[] = [];

        this.action.handle(inputs, options);
      });
  }
}
```

## `./commands/create.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { throwError } from '../lib/utils/throw-error';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class CreateCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('create')
      .alias('c')
      .description('Create the basic structure for a new Hedhog library.')
      .argument('<string>', 'library name')
      .option(
        '-f, --force',
        'Force the creation of the module even if the directory already has files.',
        false,
      )
      .option(
        '-r, --remove-default-deps',
        'Remove default dependencies.',
        false,
      )
      .option('--debug', 'Show debug information.', false)
      .option(
        '-P, --package-manager [packageManager]',
        'Specify package manager.',
        'npm',
      )
      .action(async (name, command) => {
        try {
          if (!name) {
            throw new Error('Library name is required');
          }

          const options: Input[] = [];
          options.push({
            name: 'remove-default-deps',
            value: command.removeDefaultDeps,
          });
          options.push({
            name: 'packageManager',
            value: command.packageManager,
          });
          options.push({
            name: 'force',
            value: command.force,
          });
          options.push({
            name: 'debug',
            value: command.debug,
          });

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });
          await this.action.handle(inputs, options);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
```

## `./commands/index.ts`

```ts
export * from './command.input';
export * from './command.loader';
```

## `./commands/info.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';

export class InfoCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('info')
      .alias('i')
      .description('Display Nest project details.')
      .action(async () => {
        await this.action.handle();
      });
  }
}
```

## `./commands/new.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { throwError } from '../lib/utils/throw-error';
import { validateDirectory } from '../lib/utils/validade-directory';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class NewCommand extends AbstractCommand {
  public load(program: Command) {
    program
      .command('new')
      .alias('n')
      .description('Generate Hedhog project.')
      .argument('<string>', 'project name')
      .option(
        '--directory <directory>',
        'Specify the destination directory',
        '.',
      )
      .option('-g, --skip-git', 'Skip git repository initialization.', false)
      .option('-s, --skip-install', 'Skip package installation.', false)
      .option(
        '-P, --package-manager [packageManager]',
        'Specify package manager.',
        'npm',
      )
      .option(
        '-d, --database [database]',
        'Specify database postgres or mysql.',
      )
      .option('-h, --dbhost [host]', 'Specify database host.')
      .option('-p, --dbport [port]', 'Specify database port.')
      .option('-u, --dbuser [user]', 'Specify database user.')
      .option('-w, --dbpassword [password]', 'Specify database password.')
      .option('-n, --dbname [database]', 'Specify database name.')
      .option(
        '-f, --force',
        'Force project creation if directory exists.',
        false,
      )
      .option(
        '-c, --docker-compose',
        'Create a docker-compose file if connection failed.',
        false,
      )
      .option('--data-volume <path>', 'Database volume path.', '')
      .option('--debug', 'Show debug information.', false)
      .action(async (name, command) => {
        try {
          if (!name) {
            throw new Error('Name is required');
          }

          if (!validateDirectory(command.directory)) {
            throw new Error('Directory is not valid');
          }

          const options: Input[] = [];

          options.push({
            name: 'data-volume',
            value:
              command.dataVolume.length > 0
                ? command.dataVolume
                : `${name}-volume`,
          });
          options.push({ name: 'dbhost', value: command.dbhost ?? '' });
          options.push({ name: 'dbport', value: command.dbport ?? '' });
          options.push({ name: 'dbuser', value: command.dbuser ?? '' });
          options.push({ name: 'dbpassword', value: command.dbpassword ?? '' });
          options.push({ name: 'dbname', value: command.dbname ?? '' });
          options.push({ name: 'database', value: command.database ?? '' });
          options.push({ name: 'directory', value: command.directory });
          options.push({ name: 'skip-git', value: command.skipGit });
          options.push({ name: 'skip-install', value: command.skipInstall });
          options.push({ name: 'force', value: command.force });
          options.push({
            name: 'docker-compose',
            value: command.dockerCompose,
          });
          options.push({
            name: 'debug',
            value: command.debug,
          });
          options.push({
            name: 'packageManager',
            value: command.packageManager,
          });

          const inputs: Input[] = [];
          inputs.push({ name: 'name', value: name });

          await this.action.handle(inputs, options);
        } catch (error) {
          throwError(error.message);
        }
      });
  }
}
```

## `./commands/refresh.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class RefreshCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('refresh')
      .alias('r')
      .argument('<string>', 'Dependency name to be added.')
      .description(
        'Removes old HedHog dependencies, updates app.module.ts, deletes package-lock.json, and adds a new dependency.',
      )
      .usage('<dependency> [options]')
      .action(async (dependency, command) => {
        const options: Input[] = [];
        const inputs: Input[] = [];

        inputs.push({ name: 'name', value: dependency });
        this.action.handle(inputs, options);
      });
  }
}
```

## `./commands/reset.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ResetCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('reset')
      .description(
        'Redefines the hedhog project by removing all additional dependencies and their migrations.',
      )
      .usage('<dependency> [options]')
      .action(async (dependency, command) => {
        const options: Input[] = [];
        const inputs: Input[] = [];

        this.action.handle(inputs, options);
      });
  }
}
```

## `./commands/start.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';

/**
 * Represents the command to start the application.
 *
 * @extends AbstractCommand
 */
export class StartCommand extends AbstractCommand {

  /**
   * Registers the 'start' command with the given program.
   *
   * @param {Command} program - The command program to which the 'start' command will be added.
   */
  public load(program: Command) {
    program
      .command('start')
      .description('Start the application')
      .action(async () => {
        await this.action.handle();
      });
  }
}
```

## `./commands/validate.command.ts`

```ts
import { Command } from '@commander-js/extra-typings';
import { AbstractCommand } from './abstract.command';
import { Input } from './command.input';

export class ValidateCommand extends AbstractCommand {
  public load(program: Command): void {
    program
      .command('validate')
      .argument('<string>', 'module name')
      .option('--debug', 'Show debug information.', false)
      .description('Validade Hedhog files.')
      .usage('<module> [options]')
      .action(async (module, command) => {
        const options: Input[] = [];

        options.push({
          name: 'debug',
          value: command.debug,
        });
        const inputs: Input[] = [];
        inputs.push({ name: 'module', value: module });
        this.action.handle(inputs, options);
      });
  }
}
```

## `./lib/classes/DtoCreator.ts`

```ts
import { render } from 'ejs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Column } from '../types/column';
import { capitalize } from '../utils/convert-string-cases';
import { formatTypeScriptCode } from '../utils/format-typescript-code';

export class DTOCreator {
  private libraryPath: string;
  private fields: Column[];
  private hasLocale: boolean;

  constructor(libraryPath: string, fields: Column[], hasLocale: boolean) {
    this.libraryPath = libraryPath;
    this.fields = fields;
    this.hasLocale = hasLocale;
  }

  async createDTOs() {
    const dtoPath = join(this.libraryPath, 'dto');
    await mkdir(dtoPath, { recursive: true });

    await this.createDTO('create', dtoPath);
    await this.createDTO('update', dtoPath);
  }

  private getPrimitiveType(type: string): string {
    const typeMapping: Record<string, string> = {
      varchar: 'string',
      date: 'string',
      text: 'string',
      int: 'number',
      decimal: 'number',
      fk: 'number',
      boolean: 'boolean',
    };
    return typeMapping[type] || 'string';
  }

  private async writeFormattedFile(filePath: string, content: string) {
    const formattedContent = await formatTypeScriptCode(content, {
      parser: 'typescript',
      singleQuote: true,
      trailingComma: 'all',
      semi: true,
    });
    await writeFile(filePath, formattedContent);
  }

  private async loadTemplate(templateName: string): Promise<string> {
    const templatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'dto',
      templateName,
    );
    return readFile(templatePath, 'utf-8');
  }

  private hasOptional(column: Column): boolean {
    return column.isNullable || column.default !== undefined;
  }

  private async createDTO(type: 'create' | 'update', dtoPath: string) {
    const importsSet = new Set<string>();
    const dtoFields: string[] = [];
    const dtoImports = new Set<string>();
    let hasOptional = false;

    if (type === 'create') {
      // Process fields for "create" DTO
      for (const field of this.fields) {
        const primitiveType = this.getPrimitiveType(field.type);
        dtoImports.add(primitiveType);

        const renderedField = await this.renderField(field, primitiveType);
        if (this.hasOptional(field)) {
          hasOptional = true;
        }
        dtoFields.push(renderedField);
      }

      await this.addImports(dtoImports, importsSet, hasOptional);

      const dtoContent = await this.renderDTO({
        fields: dtoFields,
        imports: Array.from(importsSet),
        hasLocale: this.hasLocale,
        templateName: `${type}.dto.ts.ejs`,
      });

      const filePath = join(dtoPath, `${type}.dto.ts`);
      await this.writeFormattedFile(filePath, dtoContent);
    } else if (type === 'update') {
      // Render template for "update" DTO
      const updateTemplateContent =
        await this.loadTemplate('update.dto.ts.ejs');
      const filePath = join(dtoPath, 'update.dto.ts');
      await this.writeFormattedFile(filePath, updateTemplateContent);
    }
  }

  private async renderField(field: Column, type: string): Promise<string> {
    const templateContent = await this.loadTemplate(`${type}.dto.ts.ejs`);
    return render(templateContent, {
      fieldName: field.name,
      optionalSignal: this.hasOptional(field) ? '?' : '',
      isOptional: this.hasOptional(field),
    });
  }

  private async addImports(
    dtoImports: Set<string>,
    importsSet: Set<string>,
    hasOptional: boolean,
  ) {
    const importTemplateContent = await this.loadTemplate('import.dto.ts.ejs');
    const types = Array.from(dtoImports).map((type) => `Is${capitalize(type)}`);
    if (hasOptional) {
      types.push('IsOptional');
    }

    const renderedImport = render(importTemplateContent, {
      types: types.join(','),
    });

    importsSet.add(renderedImport);
  }

  private async renderDTO(params: {
    fields: string[];
    imports: string[];
    hasLocale: boolean;
    templateName: string;
  }): Promise<string> {
    const { fields, imports, hasLocale, templateName } = params;
    const templateContent = await this.loadTemplate(templateName);
    return render(templateContent, {
      fields: fields.join('\n\n'),
      imports: imports.join('\n'),
      hasLocale,
    });
  }
}
```

## `./lib/classes/FileCreator.ts`

```ts
import { render } from 'ejs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AbstractTable } from '../tables/abstract.table';
import { Column } from '../types/column';
import { toKebabCase, toObjectCase } from '../utils/convert-string-cases';
import { filterScreenCreation } from '../utils/filter-screen-creation';
import { formatTypeScriptCode } from '../utils/format-typescript-code';
import { formatWithPrettier } from '../utils/format-with-prettier';
import getLocaleYaml from '../utils/get-fk-locale-yaml';
import { TableApply } from './TableApply';

interface IOption {
  useLibraryNamePath?: boolean;
  importServices?: boolean;
  hasRelationsWith?: string;
  tablesWithRelations?: IRelation[];
  localeTables?: any[];
}

interface IRelation {
  name: string;
  relations: string[];
}

interface IFields {
  name: string;
  isLocale: boolean;
}

type FileType = 'controller' | 'service' | 'module' | 'screen';

export class FileCreator {
  private libraryPath: string;
  private libraryName: string;
  private table: TableApply;
  private fileType: 'controller' | 'service' | 'module' | 'screen';
  private options: IOption;
  private fieldsForSearch: IFields[];

  constructor(
    libraryPath: string,
    libraryName: string,
    table?: TableApply,
    fileType?: 'controller' | 'service' | 'module' | 'screen',
    options: IOption = {
      useLibraryNamePath: false,
      importServices: false,
      hasRelationsWith: '',
      tablesWithRelations: [],
      localeTables: [],
    },
  ) {
    this.libraryPath = libraryPath;
    this.libraryName = libraryName;
    this.table = table as TableApply;
    this.fileType = fileType as FileType;
    this.options = options;
    this.fieldsForSearch = [];
  }

  private getFileFullPath(): string {
    if (this.fileType === 'screen') {
      const componentsPath = join(
        this.getFilePath(),
        '..',
        '..',
        'frontend',
        `${this.table.name.toKebabCase()}`,
        'components',
      );

      if (!existsSync(componentsPath)) {
        mkdirSync(componentsPath);
      }

      return join(
        componentsPath,
        `${this.table.name.toKebabCase()}.${this.fileType}.tsx.ejs`,
      );
    }

    return join(
      this.getFilePath(),
      `${this.table.name.toKebabCase()}.${this.fileType}.ts`,
    );
  }

  private filterFields(array: Column[]) {
    return array
      .map((field) => AbstractTable.getColumnOptions(field))
      .filter((field) => !['created_at', 'updated_at'].includes(field.name))
      .filter((field) => !field.references)
      .filter((field) => !field.isPrimary)
      .map((field) => {
        return {
          name: field.name,
          isLocale: false,
        };
      });
  }

  private getFilePath(): string {
    if (this.fileType === 'screen') {
      return join(this.libraryPath, this.table.name.toKebabCase());
    }

    return join(
      this.libraryPath,
      this.options.hasRelationsWith
        ? toKebabCase(this.options.hasRelationsWith)
        : '',
      this.options.useLibraryNamePath ? this.table.name.toKebabCase() : 'src',
    );
  }

  async createFile() {
    if (this.fileType === 'screen') {
      if (!(await filterScreenCreation(this.libraryPath, this.table.name))) {
        return;
      }
    }

    const filePath = this.getFilePath();

    await mkdir(filePath, { recursive: true });
    const tablesWithRelations = (this.options.tablesWithRelations ?? [])
      .map((t) => t.relations)
      .flat();

    if (
      tablesWithRelations.includes(this.table.name) &&
      this.fileType === 'module'
    ) {
      return;
    }

    if (
      this.options.tablesWithRelations &&
      this.options.tablesWithRelations.length &&
      this.options.tablesWithRelations[0].name === this.table.name &&
      this.fileType === 'module'
    ) {
      await this.createParentModuleFile(tablesWithRelations);
      return;
    }

    await mkdir(filePath, { recursive: true });

    if (this.table.getColumns !== undefined) {
      this.fieldsForSearch = this.filterFields(this.table.getColumns());
    }

    let localeTable = null;
    if (this.table.hasLocale && this.options.localeTables) {
      localeTable = this.options.localeTables.find(
        (locale) => locale.name === `${this.table.name}_locale`,
      );
    }

    if (localeTable) {
      const fieldLocaleTable = localeTable.columns.find(
        (c: Column) => c.locale,
      )?.name;

      if (fieldLocaleTable) {
        this.fieldsForSearch = [
          ...this.fieldsForSearch,
          {
            name: fieldLocaleTable,
            isLocale: true,
          },
        ];
      }
    }

    const fileContent = await this.generateFileContent();
    const fileFullPath = this.getFileFullPath();

    await writeFile(
      fileFullPath,
      await formatWithPrettier(fileContent, {
        parser: 'typescript',
        trailingComma: 'none',
        semi: true,
        singleQuote: true,
        printWidth: 80,
        tabWidth: 2,
        endOfLine: 'lf',
      }),
    );
  }

  private async createParentModuleFile(tablesWithRelations: string[]) {
    const parentModulePath = join(
      this.libraryPath,
      toKebabCase(this.options.tablesWithRelations![0].name),
      `${toKebabCase(this.options.tablesWithRelations![0].name)}.module.ts`,
    );

    const templatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'module',
      'module-related.ts.ejs',
    );

    const templateContent = await readFile(templatePath, 'utf-8');
    const data = {
      tableNameCase: toObjectCase(this.table.name),
      options: {
        importServices: true,
        tablesWithRelations,
      },
    };

    const renderedContent = render(templateContent, data);
    const formattedContent = await formatTypeScriptCode(renderedContent);
    await writeFile(parentModulePath, formattedContent);
  }

  private getTemplatePath() {
    const baseTemplatePath = join(__dirname, '..', '..', 'templates');
    const templatePath = join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}.ts.ejs`,
    );
    const templateRelationsPath = join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}-related.ts.ejs`,
    );
    const templateRelationsLocalePath = join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}-related-locale.ts.ejs`,
    );
    const templateLocalePath = join(
      baseTemplatePath,
      this.fileType,
      `${this.fileType}-locale.ts.ejs`,
    );

    if (this.fileType === 'module') {
      return this.options.hasRelationsWith
        ? templateRelationsPath
        : templatePath;
    }

    if (this.fileType === 'screen') {
      return templatePath;
    }

    if (this.table.hasLocale) {
      return this.options.hasRelationsWith
        ? templateRelationsLocalePath
        : templateLocalePath;
    }

    return this.options.hasRelationsWith ? templateRelationsPath : templatePath;
  }

  private async generateFileContent() {
    const vars: any = {
      tableNameCase: this.table.name,
      fieldsForSearch:
        this.fileType === 'screen'
          ? this.fieldsForSearch
          : this.fieldsForSearch.map((f) => f.name),
      relatedTableNameCase: String(this.options.hasRelationsWith),
      options: this.options,
      fkNameCase: this.table.fkName,
      pkNameCase: this.table.pkName,
      hasLocale: this.table.hasLocale,
      libraryName: this.libraryName,
      fkNameLocaleCase: await getLocaleYaml(this.libraryPath, this.table.name),
      module: {
        imports: this.options.importServices
          ? [
              `import { ${this.table.name.toPascalCase()}Service } from './${this.table.name.toKebabCase()}.service'`,
              `import { ${this.table.name.toPascalCase()}Controller } from './${this.table.name.toKebabCase()}.controller';`,
            ]
          : [],
        controllers: this.options.importServices
          ? [`${this.table.name.toPascalCase()}Controller`]
          : [],
        providers: this.options.importServices
          ? [`${this.table.name.toPascalCase()}Service`]
          : [],
        exports: this.options.importServices
          ? [`${this.table.name.toPascalCase()}Service`]
          : [],
      },
    };
    for (const field in vars) {
      if (typeof vars[field] === 'string' && field.endsWith('Case')) {
        vars[field] = toObjectCase(vars[field]);
      }
    }

    return render(await readFile(this.getTemplatePath(), 'utf-8'), vars);
  }
}
```

## `./lib/classes/HedHogFile.ts`

```ts
import { writeFile } from 'fs/promises';
import { stringify } from 'yaml';
import { Menu } from '../types/menu';
import { Table } from '../types/table';
import { loadHedhogFile } from '../utils/load-hedhog-file';

export interface Route {
  url: string;
  method: string;
  relations?: any;
}

interface ReactRoute {
  path: string;
  component?: string;
  lazy?: {
    component: string;
  };
  children?: ReactRoute[];
}

interface HedhogData {
  route?: Route[];
  menu?: Menu[];
  screen?: Screen[];
}

export type HedhogFileType = {
  tables?: Record<string, any>;
  screens?: Record<string, any>;
  data?: HedhogData;
  routes?: ReactRoute[];
};

export class HedhogFile {
  private _path: string = '';
  private _content: HedhogFileType = {};

  async load(path: string) {
    this._path = path;
    await this.init();
    return this;
  }

  private async init() {
    this._content = await loadHedhogFile(this._path);
  }

  get tables() {
    return this._content.tables ?? {};
  }

  set tables(tables: Record<string, any>) {
    this._content.tables = tables;
  }

  get data() {
    return this._content.data ?? {};
  }

  set data(data: Record<string, any>) {
    this._content.data = data;
  }

  get screens() {
    return this._content.screens ?? {};
  }

  set screens(screens: Record<string, any>) {
    this._content.screens = screens;
  }

  get routes() {
    return this._content.routes ?? [];
  }

  set routes(routes: ReactRoute[]) {
    this._content.routes = routes;
  }

  get tableNames(): string[] {
    return Object.keys(this._content.tables || {});
  }

  async save() {
    const newYamlContent = stringify(this._content);
    return writeFile(this._path, newYamlContent, 'utf8');
  }

  getTables(): Table[] {
    return this.tableNames.map((tableName) => ({
      name: tableName,
      columns: this._content.tables?.[tableName]?.columns.map(
        this.applyColumnDefaults,
      ),
      ifNotExists: this._content.tables?.[tableName].ifNotExists,
    })) as Table[];
  }

  applyColumnDefaults(column: any) {
    return {
      name:
        column.type === 'pk'
          ? 'id'
          : column.type === 'slug'
            ? 'slug'
            : column.type === 'created_at'
              ? 'created_at'
              : column.type === 'updated_at'
                ? 'updated_at'
                : column.type === 'deleted_at'
                  ? 'deleted_at'
                  : column.type === 'order'
                    ? 'order'
                    : undefined,
      ...column,
      isPrimary: column.isPrimary || column.type === 'pk',
      isNullable: column.isNullable || false,
    };
  }

  getTable(tableName: string): Table {
    return {
      name: tableName,
      columns: this._content.tables?.[tableName]?.columns.map(
        this.applyColumnDefaults,
      ),
      ifNotExists: this._content.tables?.[tableName].ifNotExists,
    };
  }

  hasLocale(tableName: string) {
    const key = `${tableName}_locale`;
    return this._content.tables ? key in this._content.tables : false;
  }

  get screensWithRelations() {
    if (!this._content.screens) {
      return [];
    }

    const screens = this._content.screens || {};
    return Object.keys(screens)
      .filter((screen) => screens[screen].relations)
      .map((screen) => ({
        name: screen,
        relations: Object.keys(screens[screen].relations),
      }));
  }
}
```

## `./lib/classes/TableApply.ts`

```ts
import { Table } from '../types/table';
import { HedhogFile } from './HedHogFile';

export class TableApply {
  private _hedhogFile: HedhogFile = new HedhogFile();
  private _hasRelations = false;
  private _hasLocale = false;
  private _baseName = '';
  private _tableNameRelation = '';
  private _pkName = '';
  private _fkName = '';


  /**
   * Constructor for TableApply.
   *
   * @param {Table} _table TypeORM Table instance.
   * @description
   * This constructor takes a TypeORM Table instance and applies
   * additional properties required for the workflow of the hedhog
   * project. It calls methods to set the base name, has locale,
   * has relations, table name relation, and primary/foreign key
   * names.
   */
  constructor(private _table: Table) {
    this.initBaseName();
    this.initHasLocale();
  }


  /**
   * @description
   * Return the name of the table.
   * @returns {string}
   */
  get name(): string {
    return this._table.name;
  }

  get baseName() {
    if (!this._baseName) {
      this.initBaseName();
    }
    return this._baseName;
  }

  get hasRelations() {
    return this._hasRelations;
  }

  get hasLocale() {
    if (!this._hasLocale) {
      this.initHasLocale();
    }
    return this._hasLocale;
  }

  get tableNameRelation() {
    if (!this._tableNameRelation) {
      this.findTableWithRelation();
    }
    return this._tableNameRelation;
  }

  get pkName() {
    if (!this._pkName) {
      this._pkName =
        this.getColumns().find((column) => column.type === 'pk')?.name || '';
    }
    return this._pkName;
  }

  get fkName() {
    if (!this._fkName) {
      if (!this._tableNameRelation) {
        this.findTableWithRelation();
      }
      this._fkName =
        this.getColumns().find(
          (t) => t.references?.table === this.tableNameRelation,
        )?.name ?? '';
    }
    return this._fkName;
  }

  get hedhogFile() {
    return this._hedhogFile;
  }

  initHasLocale() {
    this._hasLocale = this._hedhogFile.hasLocale(this._table.name);
  }

  initBaseName() {
    this._baseName = this._table.name.replace(/_locales$/, '');
  }

  setHedhogFile(hedhogFile: any) {
    this._hedhogFile = hedhogFile;
  }

  findTableWithRelation() {
    const relations = this._hedhogFile.screensWithRelations
      .filter((item) => item.relations.includes(this._table.name))
      .map((item) => item.name);

    return (this._tableNameRelation = relations.length ? relations[0] : '');
  }

  getColumns() {
    return this._table.columns.map((column) => {
      if (!column.name) {
        switch (column.type) {
          case 'pk':
            column.name = 'id';
            break;
          case 'order':
          case 'slug':
          case 'created_at':
          case 'updated_at':
            column.name = column.type;
        }
      }
      return column;
    });
  }
}
```

## `./lib/classes/TableFactory.ts`

```ts
import { Table } from '../types/table';
import { HedhogFile } from './HedHogFile';
import { TableApply } from './TableApply';

export class TableFactory {
  static async create(table: Table, hedhogPath: string) {
    const hedhogFile = await new HedhogFile().load(hedhogPath);
    const tableApply = new TableApply(table);
    await tableApply.setHedhogFile(hedhogFile);
    return tableApply;
  }
}
```

## `./lib/classes/TemplateProcessor.ts`

```ts
import { render } from 'ejs';
import { readFile } from 'fs/promises';
import { join } from 'node:path';
import { toObjectCase } from '../utils/convert-string-cases';

class TemplateProcessor {
  private relationTables: any[];
  private panelTemplatePath: string;
  private customTemplatePath: string;
  private functionTemplatePath: string;
  private extraVars: string[];
  private extraImports: string[];
  private libraryNameCase: object;

  constructor(relationTables: any[], libraryName: string) {
    this.relationTables = relationTables;
    this.panelTemplatePath = join(__dirname, '..', '..', 'templates', 'panel');
    this.functionTemplatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'function',
    );
    this.customTemplatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'custom',
    );
    this.extraVars = [];
    this.extraImports = [];
    this.libraryNameCase = toObjectCase(libraryName);
  }

  private async renderTemplate(
    templatePath: string,
    context: object = {},
  ): Promise<string> {
    const templateContent = await readFile(templatePath, 'utf-8');
    return render(templateContent, context);
  }

  private async processTable(tableName: string): Promise<{
    variableRendering: string;
    importsRendering: string;
  }> {
    const tableNameCase = toObjectCase(tableName);
    const [variableRendering, importsRendering] = await Promise.all([
      this.renderTemplate(
        join(this.panelTemplatePath, 'tab-panel-vars.ts.ejs'),
        { tableNameCase },
      ),
      this.renderTemplate(
        join(this.panelTemplatePath, 'tab-panel-imports.ts.ejs'),
        { tableNameCase, libraryNameCase: this.libraryNameCase },
      ),
    ]);

    return { variableRendering, importsRendering };
  }

  private async processRelatedFunctions(relatedTable: string): Promise<{
    openUpdateRendering: string;
    openCreateRendering: string;
    openDeleteRendering: string;
  }> {
    const tableNameRelatedCase = toObjectCase(relatedTable);

    const [openUpdateRendering, openCreateRendering, openDeleteRendering] =
      await Promise.all([
        this.renderTemplate(
          join(this.functionTemplatePath, 'open-update.ts.ejs'),
          { tableNameRelatedCase, libraryNameCase: this.libraryNameCase },
        ),
        this.renderTemplate(
          join(this.functionTemplatePath, 'open-create.ts.ejs'),
          { tableNameRelatedCase, libraryNameCase: this.libraryNameCase },
        ),
        this.renderTemplate(
          join(this.functionTemplatePath, 'open-delete.ts.ejs'),
          { tableNameRelatedCase, libraryNameCase: this.libraryNameCase },
        ),
      ]);

    return { openUpdateRendering, openCreateRendering, openDeleteRendering };
  }

  private async processStaticImports(): Promise<void> {
    const [useAppVars, useAppImports] = await Promise.all([
      this.renderTemplate(join(this.customTemplatePath, 'static-vars.ts.ejs')),
      this.renderTemplate(
        join(this.customTemplatePath, 'static-imports.ts.ejs'),
      ),
    ]);

    this.extraVars.push(useAppVars);
    this.extraImports.push(useAppImports);
  }

  async processAllTables(): Promise<{
    extraVars: string[];
    extraImports: string[];
  }> {
    await this.processStaticImports();
    for (const tableName of this.relationTables) {
      const { variableRendering, importsRendering } =
        await this.processTable(tableName);

      const { openUpdateRendering, openCreateRendering, openDeleteRendering } =
        await this.processRelatedFunctions(tableName);

      this.extraVars.push(
        variableRendering,
        openCreateRendering,
        openUpdateRendering,
        openDeleteRendering,
      );
      this.extraImports.push(importsRendering);
    }

    return { extraVars: this.extraVars, extraImports: this.extraImports };
  }
}

export default TemplateProcessor;
```

## `./lib/databases/abstract.database.ts`

```ts
import { Connection } from 'mysql2/promise';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { QueryOption } from '../types/query-option';
import { RelationN2NResult } from '../types/relation-n2n-result';
import { TransactionQueries } from '../types/transaction-queries';
import { Database } from './database';
import EventEmitter = require('events');

export class AbstractDatabase {
  private client: Client | Connection | null = null;
  private foreignKeys: any = {};
  private foreignKeysByTable: any = {};
  private primaryKeys: any = {};
  private columnNameFromRelation: any = {};
  private relationN2N: any = {};
  private relation1N: any = {};
  private columnComment: any = {};
  private tableHasColumnOrder: any = {};
  private eventEmitter = new EventEmitter();
  private autoClose = true;

  constructor(
    protected type: Database,
    protected host: string,
    protected user: string,
    protected password: string,
    protected database: string,
    protected port: number,
  ) {}

  getDataSource() {
    return new DataSource({
      type: this.type,
      host: this.host,
      port: this.port,
      username: this.user,
      password: this.password,
      database: this.database,
      synchronize: true,
      logging: false,
      entities: [],
      subscribers: [],
      migrations: [],
    });
  }

  disableAutoClose() {
    this.autoClose = false;
  }

  close() {
    return this.client?.end();
  }

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
  }

  getArrayType(values: any[]) {
    return [...new Set(values.map((value) => typeof value))][0];
  }

  getWhereWithIn(
    columnName: string,
    operator: 'in' | 'nin',
    values: string[] | number[],
  ) {
    switch (this.type) {
      case Database.POSTGRES:
        if (operator === 'in') {
          return `${this.getColumnNameWithScaping(columnName)} = ANY(?::${this.getArrayType(values) === 'number' ? 'int' : 'text'}[])`;
        } else {
          return `${this.getColumnNameWithScaping(columnName)} <> ALL(?::${this.getArrayType(values) === 'number' ? 'int' : 'text'}[])`;
        }
      case Database.MYSQL:
        return `${this.getColumnNameWithScaping(columnName)} ${operator === 'in' ? 'IN' : 'NOT IN'}(${values.map((value) => AbstractDatabase.addSimpleQuotes(value)).join(', ')})`;
    }
  }

  static addSimpleQuotes(value: any): string {
    if (typeof value === 'string') {
      return `'${value}'`;
    }

    return value;
  }

  private replacePlaceholders(query: string): string {
    let index = 1;
    return query.replace(/\?/g, () => {
      return `$${index++}`;
    });
  }

  getColumnNameWithScaping(columnName: string) {
    switch (this.type) {
      case Database.POSTGRES:
        return `"${columnName}"`;

      case Database.MYSQL:
        return `\`${columnName}\``;
    }
  }

  async getTableColumns(tableName: string) {
    switch (this.type) {
      case Database.POSTGRES:
        const columnsPg = await this.query(
          `SELECT column_name, is_nullable, udt_name AS type, column_default AS default, data_type FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = 'public'`,
        );

        const constraintsPg = await this.query(`
          SELECT kcu.column_name, ccu.table_name, tc.constraint_type
          FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
          WHERE tc.table_name = '${tableName}';
          `);

        for (let i = 0; i < columnsPg.length; i++) {
          if (
            columnsPg[i].data_type === 'USER-DEFINED' &&
            columnsPg[i].type.split('_')[
              columnsPg[i].type.split('_').length - 1
            ] === 'enum'
          ) {
            columnsPg[i].enum = await this.query(
              `
                SELECT enumlabel AS value
                FROM pg_enum
                WHERE enumtypid = '${columnsPg[i].type}'::regtype;
                `,
            );
          }
        }

        return columnsPg.map((row: any) => ({
          name: row.column_name,
          nullable: row.is_nullable === 'YES',
          type: row.type.replace('int4', 'int'),
          pk: constraintsPg.find(
            (constraint: any) =>
              constraint.column_name === row.column_name &&
              constraint.constraint_type === 'PRIMARY KEY',
          )
            ? true
            : false,
          fk:
            constraintsPg.find(
              (constraint: any) =>
                constraint.column_name === row.column_name &&
                constraint.constraint_type === 'FOREIGN KEY',
            )?.table_name ?? false,
          default: row.default !== null && row.default !== undefined,
          enum: row.enum,
        }));

      case Database.MYSQL:
        const columnsMySql = await this.query(
          `SELECT column_name, is_nullable, data_type, column_default AS \`default\`, column_type FROM information_schema.columns WHERE table_name = '${tableName}'`,
        );
        const constraintsMySql = await this.query(`
    SELECT
        kcu.column_name,
        kcu.table_name,
        tc.constraint_type
    FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        LEFT JOIN information_schema.referential_constraints AS rc
            ON rc.constraint_name = tc.constraint_name
            AND rc.constraint_schema = tc.table_schema
        LEFT JOIN information_schema.key_column_usage AS ccu
            ON ccu.constraint_name = rc.unique_constraint_name
            AND ccu.constraint_schema = rc.unique_constraint_schema
            AND ccu.ordinal_position = kcu.ordinal_position
    WHERE
        tc.table_name = '${tableName}';
    `);

        return columnsMySql.map((row: any) => ({
          name: row.column_name,
          nullable: row.is_nullable === 'YES',
          type: row.type.replace('int4', 'int'),
          pk: constraintsMySql.find(
            (constraint: any) =>
              constraint.column_name === row.column_name &&
              constraint.constraint_type === 'PRIMARY KEY',
          )
            ? true
            : false,
          fk:
            constraintsMySql.find(
              (constraint: any) =>
                constraint.column_name === row.column_name &&
                constraint.constraint_type === 'FOREIGN KEY',
            )?.table_name ?? false,
          default: row.default !== null && row.default !== undefined,
          enum: row.column_type.includes('enum(')
            ? row.column_type
                .match(/enum\((.*?)\)/)[1]
                .split(',')
                .map((e: any) => e.replace(/'/g, ''))
            : [],
        }));
    }
  }

  getTableNameFromQuery(query: string): string | null {
    const match = query.match(/INSERT INTO\s+([`"]?[\w-]+[`"]?)/i);
    if (match && match[1]) {
      return match[1].replace(/[`"]/g, '');
    }

    return null;
  }

  async hasTableColumnOrder(tableName: string) {
    if (this.tableHasColumnOrder[tableName]) {
      return this.tableHasColumnOrder[tableName];
    }

    return (this.tableHasColumnOrder[tableName] =
      (await this.getColumnComment(tableName, 'order')) === 'order');
  }

  async getColumnComment(tableName: string, columnName: string) {
    if (this.columnComment[`${tableName}.${columnName}`]) {
      return this.columnComment[`${tableName}.${columnName}`];
    }

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT a.attname AS column_name,
                col_description(a.attrelid, a.attnum) AS column_comment
          FROM pg_class AS c
          JOIN pg_attribute AS a ON a.attrelid = c.oid
          WHERE c.relname = ?
            AND a.attname = ?;`,
          [tableName, columnName],
        );

        return resultPg.length > 0
          ? (this.columnComment[`${tableName}.${columnName}`] =
              resultPg[0].column_comment)
          : '';

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT COLUMN_NAME, COLUMN_COMMENT
          FROM information_schema.COLUMNS
          WHERE TABLE_NAME = ?
            AND COLUMN_NAME = ?;`,
          [tableName, columnName],
        );

        return resultMysql.length > 0
          ? (this.columnComment[`${tableName}.${columnName}`] =
              resultMysql[0].COLUMN_COMMENT)
          : '';
    }
  }

  async getTableNameFromForeignKey(
    tableName: string,
    foreignKey: string,
  ): Promise<string> {
    if (this.foreignKeys[`${tableName}.${foreignKey}`]) {
      return this.foreignKeys[`${tableName}.${foreignKey}`];
    }

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT
            ccu.table_name
          FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ? AND kcu.column_name = ?;`,
          [tableName, foreignKey],
        );

        if (resultPg.length === 0) {
          throw new Error(
            `Foreign key ${tableName}.${foreignKey} not found in database.`,
          );
        }

        return (this.foreignKeys[`${tableName}.${foreignKey}`] =
          resultPg[0].table_name);

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT kcu.REFERENCED_TABLE_NAME as table_name
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
            JOIN information_schema.table_constraints AS tc
            ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
            WHERE kcu.TABLE_NAME = ? AND kcu.COLUMN_NAME = ? AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'`,
          [tableName, foreignKey],
        );

        if (resultMysql.length === 0) {
          throw new Error(
            `Foreign key ${tableName}.${foreignKey} not found in database.`,
          );
        }

        return (this.foreignKeys[`${tableName}.${foreignKey}`] =
          resultMysql[0].table_name);
    }
  }

  private shouldHandleReturning(options?: QueryOption): boolean {
    return options?.returning !== undefined;
  }

  private isReturningSingleField(options?: QueryOption): boolean {
    return (
      options?.returning instanceof Array && options.returning.length === 1
    );
  }

  private isReturningIdWithoutPrimaryKeys(options?: QueryOption): boolean {
    return options?.returning === 'id' && !options.primaryKeys;
  }

  private isMissingPrimaryKeys(options?: QueryOption): boolean {
    return !options?.primaryKeys;
  }

  private hasPrimaryKeys(options?: QueryOption): boolean {
    return typeof options?.primaryKeys === 'string';
  }

  private hasReturning(options?: QueryOption): boolean {
    return typeof options?.returning === 'string';
  }

  private formatOptions(options?: QueryOption) {
    if (options && this.shouldHandleReturning(options)) {
      if (this.isReturningSingleField(options)) {
        options.returning = (options.returning as any)[0];
      }
      if (this.isReturningIdWithoutPrimaryKeys(options)) {
        options.primaryKeys = options.returning;
      }

      if (this.isMissingPrimaryKeys(options)) {
        throw new Error('Primary key is required when using returning.');
      }

      if (this.hasPrimaryKeys(options)) {
        options.primaryKeys = [options.primaryKeys as string];
      }
      if (this.hasReturning(options)) {
        options.returning = [options.returning as string];
      }
    }

    return options;
  }

  private addReturningToQuery(query: string, options?: QueryOption): string {
    if (
      this.type === Database.POSTGRES &&
      this.shouldHandleReturning(options)
    ) {
      return `${query} RETURNING ${(options?.returning as string[]).join(', ')}`;
    }
    return query;
  }

  private async getResult(query: string, result: any, options?: QueryOption) {
    switch (this.type) {
      case Database.POSTGRES:
        return result.rows;

      case Database.MYSQL:
        result = result[0] as any[];

        if (this.shouldHandleReturning(options)) {
          const resultArray = [
            {
              id: (result as any).insertId,
            },
          ];

          result = resultArray;

          if (
            (Array.isArray(options?.returning) &&
              options.returning.length > 1) ||
            (options?.returning?.length === 1 &&
              options?.primaryKeys &&
              options?.returning[0] !== options?.primaryKeys[0])
          ) {
            const where = ((options?.primaryKeys as string[]) ?? [])
              .map((pk) => `${pk} = ?`)
              .join(' AND ');

            const selectReturningQuery = `SELECT ${(options?.returning as string[]).join(', ')} FROM ${this.getTableNameFromQuery(query)} WHERE ${where}`;
            const returningResult = await (
              this.client as unknown as Connection
            ).query(selectReturningQuery, [resultArray[0].id]);
            result = returningResult;
          }
        } else if (result?.insertId) {
          result = [
            {
              id: (result as any).insertId,
            },
          ];
        }

        return result;
    }
  }

  async getClient() {
    switch (this.type) {
      case Database.POSTGRES:
        const { Client } = await import('pg');
        this.client = new Client({
          host: this.host,
          user: this.user,
          password: this.password,
          database: this.database,
          port: this.port,
        });
        await this.client.connect();
        return this.client;

      case Database.MYSQL:
        const mysql = await import('mysql2/promise');
        this.client = await mysql.createConnection({
          host: this.host,
          user: this.user,
          password: this.password,
          database: this.database,
          port: this.port,
        });
        return this.client;
    }
  }

  async testDatabaseConnection(): Promise<boolean> {
    try {
      switch (this.type) {
        case Database.POSTGRES:
        case Database.MYSQL:
          await this.query('SELECT NOW()');
          break;
      }
    } catch (error) {
      return false;
    }
    return true;
  }

  async getPrimaryKeys(tableName: string): Promise<string[]> {
    if (this.primaryKeys[tableName]) {
      return this.primaryKeys[tableName];
    }

    let primaryKeys: string[] = [];

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          WHERE constraint_type = 'PRIMARY KEY'
          AND tc.table_name = ?`,
          [tableName],
        );

        primaryKeys = resultPg.map((row: any) => row.column_name);

        if (primaryKeys.length > 0) {
          this.primaryKeys[tableName] = primaryKeys;
        }

        return primaryKeys;

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'`,
          [tableName],
        );

        primaryKeys = resultMysql.map((row: any) => row.COLUMN_NAME);

        if (primaryKeys.length > 0) {
          this.primaryKeys[tableName] = primaryKeys;
        }

        return primaryKeys;
    }
  }

  async getForeignKeys(tableName: string): Promise<string[]> {
    if (this.foreignKeysByTable[tableName]) {
      return this.foreignKeysByTable[tableName];
    }

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT kcu.column_name
          FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?;`,
          [tableName],
        );
        return (this.foreignKeysByTable[tableName] = resultPg.map(
          (row: any) => row.column_name,
        ));

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_NAME = ? AND CONSTRAINT_NAME != 'PRIMARY'`,
          [tableName],
        );
        return (this.foreignKeysByTable[tableName] = resultMysql.map(
          (row: any) => row.COLUMN_NAME,
        ));
    }
  }

  async getColumnNameFromRelation(
    tableNameOrigin: string,
    tableNameDestination: string,
  ) {
    if (
      this.columnNameFromRelation[`${tableNameOrigin}.${tableNameDestination}`]
    ) {
      return this.columnNameFromRelation[
        `${tableNameOrigin}.${tableNameDestination}`
      ];
    }

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT
            tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
            FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ? AND tc.table_name = ?;`,
          [tableNameOrigin, tableNameDestination],
        );

        if (!resultPg.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database. [getColumnNameFromRelation]`,
          );
        }

        return (this.columnNameFromRelation[
          `${tableNameOrigin}.${tableNameDestination}`
        ] = resultPg[0].column_name);

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT
            TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ? AND TABLE_NAME = ?;`,
          [tableNameOrigin, tableNameDestination],
        );

        if (!resultMysql.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database.  [getColumnNameFromRelation]`,
          );
        }

        return (this.columnNameFromRelation[
          `${tableNameOrigin}.${tableNameDestination}`
        ] = resultMysql[0].COLUMN_NAME);

      default:
        throw new Error(`Unsupported database type: ${this.type}`);
    }
  }

  async getRelation1N(
    tableNameOrigin: string,
    tableNameDestination: string,
  ): Promise<string> {
    if (this.relation1N[`${tableNameOrigin}.${tableNameDestination}`]) {
      return this.relation1N[`${tableNameOrigin}.${tableNameDestination}`];
    }

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg = await this.query(
          `SELECT
            tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
            FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ? AND tc.table_name = ?;`,
          [tableNameOrigin, tableNameDestination],
        );

        if (!resultPg.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database. [getRelation1N]`,
          );
        }

        return (this.relation1N[`${tableNameOrigin}.${tableNameDestination}`] =
          resultPg[0].column_name);

      case Database.MYSQL:
        const resultMysql = await this.query(
          `SELECT
            TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ? AND TABLE_NAME = ?;`,
          [tableNameOrigin, tableNameDestination],
        );

        if (!resultMysql.length) {
          throw new Error(
            `Foreign key ${tableNameOrigin}.${tableNameDestination} not found in database. [getRelation1N]`,
          );
        }

        return (this.relation1N[`${tableNameOrigin}.${tableNameDestination}`] =
          resultMysql[0].COLUMN_NAME);
    }
  }

  async getRelationN2N(
    tableNameOrigin: string,
    tableNameDestination: string,
  ): Promise<RelationN2NResult> {
    if (this.relationN2N[`${tableNameOrigin}.${tableNameDestination}`]) {
      return this.relationN2N[`${tableNameOrigin}.${tableNameDestination}`];
    }

    let tableNameIntermediate = '';
    let columnNameOrigin = '';
    let columnNameDestination = '';
    let primaryKeyDestination = '';

    switch (this.type) {
      case Database.POSTGRES:
        const resultPg1 = await this.query(
          `SELECT
            tc.table_name, kcu.column_name
            FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ?;`,
          [tableNameOrigin],
        );

        for (const row of resultPg1) {
          const resultPg2 = await this.query(
            `SELECT
                tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
                FROM
                information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?;`,
            [row['table_name']],
          );

          for (const row2 of resultPg2) {
            if (row2['foreign_table_name'] === tableNameDestination) {
              tableNameIntermediate = row['table_name'];
              columnNameOrigin = row['column_name'];
              columnNameDestination = row2['column_name'];
              primaryKeyDestination = row2['foreign_column_name'];
              break;
            }
          }
        }

        return (this.relationN2N[`${tableNameOrigin}.${tableNameDestination}`] =
          {
            tableNameIntermediate,
            columnNameOrigin,
            columnNameDestination,
            primaryKeyDestination,
          });

      case Database.MYSQL:
        const resultMysql1 = await this.query(
          `SELECT
            kcu.TABLE_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME AS foreign_table_name,
            kcu.REFERENCED_COLUMN_NAME AS foreign_column_name
          FROM
            information_schema.KEY_COLUMN_USAGE AS kcu
          WHERE
            kcu.REFERENCED_TABLE_NAME = ?
            AND kcu.TABLE_SCHEMA = DATABASE();`,
          [tableNameOrigin],
        );

        for (const row of resultMysql1) {
          const resultMysql2 = await this.query(
            `SELECT
              kcu.TABLE_NAME,
              kcu.COLUMN_NAME,
              kcu.REFERENCED_TABLE_NAME AS foreign_table_name,
              kcu.REFERENCED_COLUMN_NAME AS foreign_column_name
            FROM
              information_schema.KEY_COLUMN_USAGE AS kcu
            WHERE
              kcu.TABLE_NAME = ?
              AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
              AND kcu.TABLE_SCHEMA = DATABASE();`,
            [row['TABLE_NAME']],
          );

          for (const row2 of resultMysql2) {
            if (row2['foreign_table_name'] === tableNameDestination) {
              tableNameIntermediate = row['TABLE_NAME'];
              columnNameOrigin = row['COLUMN_NAME'];
              columnNameDestination = row2['COLUMN_NAME'];
              primaryKeyDestination = row2['foreign_column_name'];
              break;
            }
          }
        }

        return (this.relationN2N[`${tableNameOrigin}.${tableNameDestination}`] =
          {
            tableNameIntermediate,
            columnNameOrigin,
            columnNameDestination,
            primaryKeyDestination,
          });

      default:
        throw new Error(`Unsupported database type: ${this.type}`);
    }
  }

  static parseQueryValue(value: any) {
    switch (typeof value) {
      case 'number':
      case 'boolean':
        return value;

      default:
        return `'${value}'`;
    }
  }

  static objectToWhereClause(obj: any) {
    let whereClause = '';

    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        whereClause += `${key} ${obj[key].operator} ${AbstractDatabase.parseQueryValue(obj[key].value)}`;
      } else {
        whereClause += `${key} = ${AbstractDatabase.parseQueryValue(obj[key])}`;
      }
    }

    return whereClause;
  }

  async transaction(queries: TransactionQueries[]) {
    this.eventEmitter.emit('transaction', { queries });

    if (!this.client) {
      await this.getClient();
    }

    const results: any[] = [];

    for (let i = 0; i < queries.length; i++) {
      queries[i].options = this.formatOptions(queries[i].options);
      queries[i].query = this.addReturningToQuery(
        queries[i].query,
        queries[i].options,
      );
    }

    try {
      switch (this.type) {
        case Database.POSTGRES:
          await (this.client as Client).query('BEGIN');
          for (const { query, values, options } of queries) {
            const resultPg = await (this.client as Client).query(
              this.replacePlaceholders(query),
              values,
            );
            results.push(this.getResult(query, resultPg, options));
          }
          await (this.client as Client).query('COMMIT');
          break;

        case Database.MYSQL:
          await (this.client as Connection).beginTransaction();
          for (const { query, values, options } of queries) {
            const resultMySQL = await (
              this.client as unknown as Connection
            ).query(query, values);
            results.push(this.getResult(query, resultMySQL, options));
          }
          await (this.client as Connection).commit();
          break;
      }
    } catch (error) {
      switch (this.type) {
        case Database.POSTGRES:
          await (this.client as Client).query('ROLLBACK');
          break;

        case Database.MYSQL:
          await (this.client as Connection).rollback();
          break;
      }
      throw error;
    } finally {
      if (this.autoClose) {
        await this.client?.end();
        this.client = null;
      }
    }

    return results;
  }

  async query(query: string, values?: any[], options?: QueryOption) {
    this.eventEmitter.emit('query', { query, values, options });
    if (!this.client) {
      await this.getClient();
    }
    let result;

    options = this.formatOptions(options);
    query = this.addReturningToQuery(query, options);

    try {
      switch (this.type) {
        case Database.POSTGRES:
          result = await (this.client as Client).query(
            this.replacePlaceholders(query),
            values,
          );

          break;

        case Database.MYSQL:
          result = await (this.client as unknown as Connection).query(
            query,
            values,
          );

          break;
      }
    } catch (error) {
      console.error({
        error,
        query,
        values,
        options,
      });
      this.eventEmitter.emit('error', { error, query, values, options });
    }

    result = await this.getResult(query, result, options);

    this.eventEmitter.emit('query', { result });

    if (this.autoClose) {
      await this.client?.end();
      this.client = null;
    }

    return result;
  }
}
```

## `./lib/databases/database.factory.ts`

```ts
import * as chalk from 'chalk';
import { Database } from './database';
import { MySQLDatabase } from './mysql.database';
import { PostgresDatabase } from './postgres.database';

export class DatabaseFactory {
  public static create(
    type: Database,
    host: string,
    user: string,
    password: string,
    database: string,
    port: number,
  ) {
    switch (type) {
      case Database.POSTGRES:
        return new PostgresDatabase(host, user, password, database, port);

      case Database.MYSQL:
        return new MySQLDatabase(host, user, password, database, port);

      default:
        console.info(chalk.yellow(`[WARN] Unsupported Database: ${type}`));
    }
  }
}
```

## `./lib/databases/database.ts`

```ts
export enum Database {
  POSTGRES = 'postgres',
  MYSQL = 'mysql',
}
```

## `./lib/databases/index.ts`

```ts
export * from './abstract.database';
export * from './database';
export * from './database.factory';
```

## `./lib/databases/mysql.database.ts`

```ts
import { AbstractDatabase } from './abstract.database';
import { Database } from './database';

export class MySQLDatabase extends AbstractDatabase {
  /**
   * Constructs a new instance of the MySQLDatabase class.
   *
   * @param host - The hostname of the MySQL server.
   * @param user - The username for authentication.
   * @param password - The password for authentication.
   * @param database - The name of the database to connect to.
   * @param port - The port number on which the MySQL server is running.
   */
  constructor(
    protected host: string,
    protected user: string,
    protected password: string,
    protected database: string,
    protected port: number,
  ) {
    super(Database.MYSQL, host, user, password, database, port);
  }
}
```

## `./lib/databases/postgres.database.ts`

```ts
import { AbstractDatabase } from './abstract.database';
import { Database } from './database';

export class PostgresDatabase extends AbstractDatabase {
  /**
   * Creates a new PostgresDatabase instance
   *
   * @param host - The host of the Postgres database
   * @param user - The username to use to connect to the Postgres database
   * @param password - The password to use to connect to the Postgres database
   * @param database - The name of the database to use
   * @param port - The port number to use to connect to the Postgres database
   */
  constructor(
    protected host: string,
    protected user: string,
    protected password: string,
    protected database: string,
    protected port: number,
  ) {
    super(Database.POSTGRES, host, user, password, database, port);
  }
}
```

## `./lib/entities/abstract.entity.ts`

```ts
import chalk = require('chalk');
import * as bcrypt from 'bcryptjs';
import { AbstractDatabase } from '../databases';
import { DataHash } from '../types/data-hash';
import { DataType } from '../types/data-type';
import { Locale } from '../types/locale';
import EventEmitter = require('events');

export class AbstractEntity {
  private locale: { [key: string]: number } = {};
  private eventEmitter = new EventEmitter();

  constructor(
    protected db: AbstractDatabase,
    protected name: string,
    protected data: DataType[],
  ) {}

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
  }

  static isRelation(item: DataType, key: string) {
    return key === 'relations' && typeof item[key] === 'object';
  }

  static isWhere(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      'where' in item[key] &&
      typeof item[key].where === 'object'
    );
  }

  static isLocale(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      this.countKeyLength(item[key] as Locale).length === 1 &&
      this.countKeyLength(item[key] as Locale)[0] === 2
    );
  }

  static isHash(item: DataType, key: string) {
    return (
      typeof item[key] === 'object' &&
      'hash' in item[key] &&
      typeof item[key].hash === 'string'
    );
  }

  static countKeyLength(item: Locale) {
    return [...new Set(Object.keys(item).map((key) => key.length))];
  }

  private getLocaleTableName(mainTableName: string) {
    const mainTableNameSplitted = mainTableName.split('_');
    const lastName = mainTableNameSplitted.pop() as string;
    const firstName = mainTableNameSplitted.join('_');
    const translations_suffix = 'locale';

    return !firstName
      ? `${lastName}_${translations_suffix}`
      : `${firstName}_${lastName}_${translations_suffix}`;
  }

  private async getLocaleId(code: string) {
    if (this.locale[code]) {
      return this.locale[code];
    }

    const locale = await this.db.query('SELECT id FROM locale WHERE code = ?', [
      code,
    ]);

    if (!locale.length) {
      throw new Error(`Locale with code "${code}" not found.`);
    }

    return (this.locale[code] = locale[0].id);
  }

  private parseOperator(operator: string) {
    switch (operator) {
      case 'eq':
        return '=';
      case 'ne':
        return '<>';
      case 'gt':
        return '>';
      case 'lt':
        return '<';
      case 'gte':
        return '>=';
      case 'lte':
        return '<=';
      case 'like':
        return 'LIKE';
      case 'nlike':
        return 'NOT LIKE';
      case 'in':
        return 'IN';
      case 'nin':
        return 'NOT IN';
      default:
        throw new Error(`Operator "${operator}" not found.`);
    }
  }

  private async whereResolve(
    tableName: string,
    where: Record<string, any>,
    field?: string,
  ) {
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereQuery = [] as string[];
    const whereFinal = [] as any[];

    for (let i = 0; i < whereKeys.length; i++) {
      const whereValue = whereValues[i];
      const whereField = whereKeys[i];

      if (typeof whereValue === 'object') {
        const operator = Object.keys(whereValue)[0];

        let value: string = whereValue[operator] as string;

        if (['in', 'nin'].includes(operator) && Array.isArray(value)) {
          whereQuery.push(
            this.db.getWhereWithIn(whereField, operator as 'in' | 'nin', value),
          );
        } else {
          whereQuery.push(
            `${this.db.getColumnNameWithScaping(whereField)} ${this.parseOperator(operator)} ?`,
          );
        }

        whereFinal.push(value);
      } else {
        whereQuery.push(`${this.db.getColumnNameWithScaping(whereField)} = ?`);
        whereFinal.push(whereValue);
      }
    }

    const primaryKeys = await this.db.getPrimaryKeys(tableName);

    let whereTable = tableName;

    if (field) {
      whereTable = await this.db.getTableNameFromForeignKey(tableName, field);
    }

    const whereResult = await this.db.query(
      `SELECT ${primaryKeys.map((pk) => this.db.getColumnNameWithScaping(pk)).join(', ')} FROM ${this.db.getColumnNameWithScaping(whereTable)} WHERE ${whereQuery.join(' AND ')}`,
      whereFinal,
    );

    const result = whereResult.map((item: any) => {
      if (primaryKeys.length > 1) {
        return primaryKeys.reduce((acc, key) => {
          acc[key] = item[key];
          return acc;
        }, {} as any);
      } else {
        return item[primaryKeys[0]];
      }
    });

    return result;
  }

  private sortItems(items: DataType[]) {
    const itemsWhere = items.map((item, index) => {
      let wheres = 0;

      for (const key of Object.keys(item)) {
        if (AbstractEntity.isWhere(item, key)) {
          wheres++;
        }
      }

      return {
        item,
        wheres,
      };
    });

    return (itemsWhere as any[])
      .sort((a, b) => a.wheres - b.wheres)
      .map(({ item }) => item);
  }

  private async insertLocales(
    id: number,
    mainTableName: string,
    item: DataType,
  ) {
    const localeColumns: string[] = [];

    for (const key of Object.keys(item)) {
      if (AbstractEntity.isLocale(item, key)) {
        localeColumns.push(key);
      }
    }

    const localeFields: any = {};

    for (const localeColumn of localeColumns) {
      for (const localeField of Object.keys(item[localeColumn])) {
        const localeId = await this.getLocaleId(localeField);

        if (typeof localeFields[localeId] !== 'object') {
          localeFields[localeId] = {};
        }

        localeFields[localeId][localeColumn] = (item[localeColumn] as Locale)[
          localeField
        ];
      }
    }

    for (const localeId of Object.keys(localeFields)) {
      const fields = Object.keys(localeFields[localeId]);

      const tableNameTranslations = this.getLocaleTableName(mainTableName);
      const columnName = await this.db.getColumnNameFromRelation(
        mainTableName,
        tableNameTranslations,
      );

      const query = `INSERT INTO ${tableNameTranslations} (locale_id, ${this.db.getColumnNameWithScaping(columnName)}, ${fields.map((f) => this.db.getColumnNameWithScaping(f)).join(', ')}) VALUES (${['?', '?', ...fields].map((_) => '?').join(', ')})`;
      const values = [
        Number(localeId),
        id,
        ...Object.values(localeFields[localeId]),
      ];

      try {
        await this.db.query(query, values);
      } catch (error) {
        console.error(chalk.bgRed(`ERROR:`), chalk.red(error), query, values);
      }

      this.eventEmitter.emit(
        'debug',
        `Insert translation of ${this.name} with locale id ${localeId}`,
      );
    }
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  }

  private async insert(items: DataType[], tableName = this.name) {
    items = this.sortItems(items);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mainTableName = tableName;
      const mainFields: string[] = [];
      const mainValues: any[] = [];

      this.eventEmitter.emit(
        'debug',
        `Insert ${mainTableName} with data ${JSON.stringify(item)}`,
      );

      /** Insert items */
      for (const key of Object.keys(item)) {
        if (
          !AbstractEntity.isRelation(item, key) &&
          !AbstractEntity.isWhere(item, key) &&
          !AbstractEntity.isLocale(item, key) &&
          !AbstractEntity.isHash(item, key)
        ) {
          mainFields.push(key);
          mainValues.push(item[key]);
        } else if (AbstractEntity.isWhere(item, key)) {
          const whereResult = await this.whereResolve(
            mainTableName,
            (item[key] as any).where,
            key,
          );

          let value = null;

          if (whereResult.length === 1) {
            value = whereResult[0];
          }

          mainFields.push(key);
          mainValues.push(value);
        } else if (AbstractEntity.isHash(item, key)) {
          const value = await this.hashPassword((item[key] as DataHash).hash);

          mainFields.push(key);
          mainValues.push(value);
        }
      }

      const primaryKeys = await this.db.getPrimaryKeys(mainTableName);

      this.eventEmitter.emit('debug', {
        mainTableName,
        mainFields,
        mainValues,
        primaryKeys,
      });

      const columnNameOrder = 'order';

      if (
        !mainFields.includes(columnNameOrder) &&
        (await this.db.hasTableColumnOrder(mainTableName))
      ) {
        const columnName = await this.db.getColumnNameFromRelation(
          mainTableName,
          mainTableName,
        );

        const valueIndex = mainFields.indexOf(columnName);

        const lastOrderResult = await this.db.query(
          `SELECT ${this.db.getColumnNameWithScaping(columnNameOrder)} FROM ${mainTableName} WHERE ${this.db.getColumnNameWithScaping(columnName)} ${mainValues[valueIndex] === undefined ? 'IS NULL' : `= ?`} ORDER BY ${this.db.getColumnNameWithScaping(columnNameOrder)} DESC LIMIT 1`,
          mainValues[valueIndex] === undefined ? [] : [mainValues[valueIndex]],
        );

        const currentOrder = lastOrderResult[0]?.order ?? -1;

        mainFields.push(columnNameOrder);
        mainValues.push(currentOrder + 1);
        this.eventEmitter.emit('debug', {
          lastOrder: currentOrder,
          nextOrder: currentOrder + 1,
          tableName,
        });
      }

      const id = (
        await this.db.query(
          `INSERT INTO ${this.db.getColumnNameWithScaping(mainTableName)} (${mainFields.map((f) => this.db.getColumnNameWithScaping(f)).join(', ')}) VALUES (${mainValues.map((_) => '?').join(', ')})`,
          mainValues,
          {
            returning: primaryKeys,
            primaryKeys,
          },
        )
      )[0][primaryKeys[0]];

      this.eventEmitter.emit('debug', `Insert ${mainTableName} with id ${id}`);

      /** Key with locales */
      await this.insertLocales(id, mainTableName, item);

      /** Key relations */
      for (const key of Object.keys(item)) {
        if (AbstractEntity.isRelation(item, key)) {
          for (const tableNameRelation of Object.keys(item[key])) {
            const relationItemKeys = Object.keys(
              (item[key] as any)[tableNameRelation],
            );

            const relationItems = [] as DataType[];

            for (const relationItemKey of relationItemKeys) {
              const relationItem = (item[key] as any)[tableNameRelation][
                relationItemKey
              ];
              if (
                typeof relationItem === 'object' &&
                'where' in relationItem &&
                typeof relationItem.where === 'object'
              ) {
                const relationN2N = await this.db.getRelationN2N(
                  mainTableName,
                  tableNameRelation,
                );

                const foreignIds = await this.whereResolve(
                  tableNameRelation,
                  relationItem.where,
                );

                for (const foreignId of foreignIds) {
                  this.eventEmitter.emit('debug', {
                    relationN2N,
                  });

                  const query = `INSERT INTO ${this.db.getColumnNameWithScaping(relationN2N.tableNameIntermediate)} (${this.db.getColumnNameWithScaping(relationN2N.columnNameOrigin)}, ${this.db.getColumnNameWithScaping(relationN2N.columnNameDestination)}) VALUES (?, ?)`;
                  const values = [id, foreignId];

                  try {
                    await this.db.query(query, values);
                  } catch (error) {
                    console.error(
                      chalk.bgRed(`ERROR:`),
                      chalk.red(error),
                      query,
                      values,
                    );
                  }

                  this.eventEmitter.emit(
                    'debug',
                    `Insert relation N2N ${mainTableName} with id ${id}`,
                  );
                }
              } else {
                const columnName1N = await this.db.getRelation1N(
                  mainTableName,
                  tableNameRelation,
                );

                relationItem[columnName1N] = id;

                for (const relationItemKey of Object.keys(relationItem)) {
                  if (
                    typeof relationItem[relationItemKey] === 'object' &&
                    'where' in relationItem[relationItemKey] &&
                    typeof relationItem[relationItemKey].where === 'object'
                  ) {
                    const tableNameForeign =
                      await this.db.getTableNameFromForeignKey(
                        tableNameRelation,
                        relationItemKey,
                      );

                    const whereResult = await this.whereResolve(
                      tableNameForeign,
                      relationItem[relationItemKey].where,
                    );

                    let foreignId = null;

                    if (whereResult.length === 1) {
                      foreignId = whereResult[0];
                    }

                    relationItem[relationItemKey] = foreignId;
                  }
                }

                relationItems.push(relationItem);
              }
            }
            await this.insert(relationItems, tableNameRelation);
          }
        }
      }
    }
  }

  async apply() {
    await this.insert(this.data);
  }
}
```

## `./lib/entities/entity.factory.ts`

```ts
import { AbstractDatabase } from '../databases';
import { DataType } from '../types/data-type';
import { AbstractEntity } from './abstract.entity';

export class EntityFactory {
  public static create(db: AbstractDatabase, name: string, data: DataType[]) {
    switch (name) {
      default:
        return new AbstractEntity(db, name, data);
    }
  }
}
```

## `./lib/package-managers/abstract.package-manager.ts`

```ts
import * as chalk from 'chalk';
import { readFile } from 'node:fs';
import { join } from 'node:path';
import * as ora from 'ora';
import { AbstractRunner } from '../runners/abstract.runner';
import { MESSAGES } from '../ui';
import { normalizeToKebabOrSnakeCase } from '../utils/formatting';
import { PackageManagerCommands } from './package-manager-commands';
import { ProjectDependency } from './project.dependency';

export abstract class AbstractPackageManager {
  constructor(protected runner: AbstractRunner) { }

  public async installGlobal(packageName: string) {
    const commandArguments = `${this.cli.install} -g ${packageName}`;
    await this.runner.run(commandArguments);
  }

  public async install(directory: string, packageManager: string) {
    const spinner = ora({
      spinner: {
        interval: 120,
        frames: ['▹▹▹▹▹', '▸▹▹▹▹', '▹▸▹▹▹', '▹▹▸▹▹', '▹▹▹▸▹', '▹▹▹▹▸'],
      },
      text: MESSAGES.PACKAGE_MANAGER_INSTALLATION_IN_PROGRESS,
    });
    spinner.start();
    try {
      const commandArgs = `${this.cli.install} ${this.cli.silentFlag} ${this.cli.legacyPeerDepsFlag}`;
      const collect = true;
      const normalizedDirectory = normalizeToKebabOrSnakeCase(directory);
      await this.runner.run(
        commandArgs,
        collect,
        join(process.cwd(), normalizedDirectory),
      );
      spinner.succeed();
      return packageManager;
    } catch {
      spinner.fail();
      const commandArgs = this.cli.install;
      const commandToRun = this.runner.rawFullCommand(commandArgs);
      console.error(
        chalk.red(
          MESSAGES.PACKAGE_MANAGER_INSTALLATION_FAILED(
            chalk.bold(commandToRun),
          ),
        ),
      );
    }
  }

  public async version(): Promise<string> {
    const commandArguments = '--version';
    const collect = true;
    return this.runner.run(commandArguments, collect) as Promise<string>;
  }

  public async addProduction(
    dependencies: string[],
    tag: string,
    cwd = process.cwd(),
  ): Promise<boolean> {
    const command: string = [
      this.cli.add,
      this.cli.saveFlag,
      this.cli.silentFlag,
      this.cli.legacyPeerDepsFlag,
    ]
      .filter((i) => i)
      .join(' ');

    const args = [];

    for (const dependency of dependencies) {
      args.push(`${dependency}@latest`);
    }

    const spinner = ora({
      spinner: {
        interval: 120,
        frames: ['▹▹▹▹▹', '▸▹▹▹▹', '▹▸▹▹▹', '▹▹▸▹▹', '▹▹▹▸▹', '▹▹▹▹▸'],
      },
      text: MESSAGES.PACKAGE_MANAGER_PRODUCTION_INSTALLATION_IN_PROGRESS,
    });
    spinner.start();
    try {
      await this.add(`${command} ${args.join(' ')}`, cwd);
      spinner.succeed();
      return true;
    } catch {
      spinner.fail();
      return false;
    }
  }

  public async addDevelopment(
    dependencies: string[],
    tag: string,
    cwd = process.cwd(),
  ) {
    const command = `${this.cli.add} ${this.cli.saveDevFlag}`;
    const args: string = dependencies
      .map((dependency) => `${dependency}@${tag}`)
      .join(' ');
    await this.add(`${command} ${args}`, cwd);
  }

  private async add(commandArguments: string, cwd = process.cwd()) {
    const collect = true;
    await this.runner.run(commandArguments, collect, cwd);
  }

  public async getProduction(): Promise<ProjectDependency[]> {
    const packageJsonContent = await this.readPackageJson();
    const packageJsonDependencies: any = packageJsonContent.dependencies;
    const dependencies = [];

    for (const [name, version] of Object.entries(packageJsonDependencies)) {
      dependencies.push({ name, version });
    }

    return dependencies as ProjectDependency[];
  }

  public async getDevelopment(): Promise<ProjectDependency[]> {
    const packageJsonContent = await this.readPackageJson();
    const packageJsonDevDependencies: any = packageJsonContent.devDependencies;
    const dependencies = [];

    for (const [name, version] of Object.entries(packageJsonDevDependencies)) {
      dependencies.push({ name, version });
    }

    return dependencies as ProjectDependency[];
  }

  private async readPackageJson(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      readFile(
        join(process.cwd(), 'package.json'),
        (error: NodeJS.ErrnoException | null, buffer: Buffer) => {
          if (error !== undefined && error !== null) {
            reject(error);
          } else {
            resolve(JSON.parse(buffer.toString()));
          }
        },
      );
    });
  }

  public async updateProduction(dependencies: string[]) {
    const commandArguments = `${this.cli.update} ${dependencies.join(' ')}`;
    await this.update(commandArguments);
  }

  public async updateDevelopment(dependencies: string[]) {
    const commandArguments = `${this.cli.update} ${dependencies.join(' ')}`;
    await this.update(commandArguments);
  }

  private async update(commandArguments: string) {
    const collect = true;
    await this.runner.run(commandArguments, collect);
  }

  public async upgradeProduction(dependencies: string[], tag: string) {
    await this.deleteProduction(dependencies);
    await this.addProduction(dependencies, tag);
  }

  public async upgradeDevelopment(dependencies: string[], tag: string) {
    await this.deleteDevelopment(dependencies);
    await this.addDevelopment(dependencies, tag);
  }

  public async deleteProduction(dependencies: string[]) {
    const command: string = [this.cli.remove, this.cli.saveFlag]
      .filter((i) => i)
      .join(' ');
    const args: string = dependencies.join(' ');
    await this.delete(`${command} ${args}`);
  }

  public async deleteDevelopment(dependencies: string[]) {
    const commandArguments = `${this.cli.remove} ${this.cli.saveDevFlag
      } ${dependencies.join(' ')}`;
    await this.delete(commandArguments);
  }

  public async delete(commandArguments: string) {
    const collect = true;
    await this.runner.run(commandArguments, collect);
  }

  public async runScript(
    scriptName: string,
    directory = process.cwd(),
    collect = false,
  ) {
    const commandArguments = `${this.cli.run} ${scriptName}`;
    return this.runner.run(commandArguments, collect, directory);
  }

  public abstract get name(): string;

  public abstract get cli(): PackageManagerCommands;
}
```

## `./lib/package-managers/index.ts`

```ts
export * from './abstract.package-manager';
export * from './npm.package-manager';
export * from './package-manager';
export * from './package-manager-commands';
export * from './package-manager.factory';
export * from './pnpm.package-manager';
export * from './project.dependency';
export * from './yarn.package-manager';
```

## `./lib/package-managers/npm.package-manager.ts`

```ts
import { Runner, RunnerFactory } from '../runners';
import { NpmRunner } from '../runners/npm.runner';
import { AbstractPackageManager } from './abstract.package-manager';
import { PackageManager } from './package-manager';
import { PackageManagerCommands } from './package-manager-commands';

export class NpmPackageManager extends AbstractPackageManager {
  /**
   * Initializes a new instance of the NpmPackageManager class.
   * @constructor
   */
  constructor() {
    super(RunnerFactory.create(Runner.NPM) as NpmRunner);
  }

  /**
   * Gets the name of the package manager.
   * @returns The name of the package manager.
   */
  public get name() {
    return PackageManager.NPM.toUpperCase();
  }

  /**
   * Gets the CLI commands for the package manager.
   * @returns The CLI commands for the package manager.
   */
  get cli(): PackageManagerCommands {
    return {
      install: 'install',
      add: 'install',
      update: 'update',
      remove: 'uninstall',
      saveFlag: '--save',
      saveDevFlag: '--save-dev',
      silentFlag: '--silent',
      legacyPeerDepsFlag: '--legacy-peer-deps',
      run: 'run',
    };
  }
}
```

## `./lib/package-managers/package-manager-commands.ts`

```ts
export interface PackageManagerCommands {
  install: string;
  add: string;
  update: string;
  remove: string;
  saveFlag: string;
  saveDevFlag: string;
  silentFlag: string;
  legacyPeerDepsFlag: string;
  run: string;
}
```

## `./lib/package-managers/package-manager.factory.ts`

```ts
import { readdir } from 'node:fs/promises';
import { AbstractPackageManager } from './abstract.package-manager';
import { NpmPackageManager } from './npm.package-manager';
import { PackageManager } from './package-manager';
import { PnpmPackageManager } from './pnpm.package-manager';
import { YarnPackageManager } from './yarn.package-manager';

export class PackageManagerFactory {
  public static create(name: PackageManager | string): AbstractPackageManager {
    switch (name) {
      case PackageManager.NPM:
        return new NpmPackageManager();
      case PackageManager.YARN:
        return new YarnPackageManager();
      case PackageManager.PNPM:
        return new PnpmPackageManager();
      default:
        throw new Error(`Package manager ${name} is not managed.`);
    }
  }

  public static async findManager(): Promise<string> {
    const DEFAULT_PACKAGE_MANAGER = PackageManager.NPM;

    try {
      const files = await readdir(process.cwd());

      const hasYarnLockFile = files.includes('yarn.lock');
      if (hasYarnLockFile) {
        return PackageManager.YARN;
      }

      const hasPnpmLockFile = files.includes('pnpm-lock.yaml');
      if (hasPnpmLockFile) {
        return PackageManager.PNPM;
      }

      return DEFAULT_PACKAGE_MANAGER;
    } catch (error) {
      return DEFAULT_PACKAGE_MANAGER;
    }
  }

  public static async find(): Promise<AbstractPackageManager> {
    return this.create(await this.findManager());
  }
}
```

## `./lib/package-managers/package-manager.ts`

```ts
export enum PackageManager {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm',
}
```

## `./lib/package-managers/pnpm.package-manager.ts`

```ts
import { Runner, RunnerFactory } from '../runners';
import { PnpmRunner } from '../runners/pnpm.runner';
import { AbstractPackageManager } from './abstract.package-manager';
import { PackageManager } from './package-manager';
import { PackageManagerCommands } from './package-manager-commands';

export class PnpmPackageManager extends AbstractPackageManager {

  /**
   * Initializes a new instance of the PnpmPackageManager class.
   * It uses the PnpmRunner to execute package management commands.
   */
  constructor() {
    super(RunnerFactory.create(Runner.PNPM) as PnpmRunner);
  }

  /**
   * Gets the name of the package manager in uppercase.
   *
   * @returns {string} The name of the package manager in uppercase format.
   */
  public get name(): string {
    return PackageManager.PNPM.toUpperCase();
  }


  /**
   * Provides the CLI commands specific to the PNPM package manager.
   * As of PNPM v5.3, all commands are shared with NPM v6.14.5. See: https://pnpm.js.org/en/pnpm-vs-npm
   *
   * @returns {PackageManagerCommands} An object containing the command strings for various package management actions.
   * - `install`: Command to install dependencies with strict peer dependencies disabled.
   * - `add`: Alias for the install command, also with strict peer dependencies disabled.
   * - `update`: Command to update dependencies.
   * - `remove`: Command to uninstall dependencies.
   * - `saveFlag`: Flag used to save installed packages as dependencies.
   * - `saveDevFlag`: Flag used to save installed packages as development dependencies.
   * - `silentFlag`: Flag to suppress output, setting the reporter to silent mode.
   * - `legacyPeerDepsFlag`: Flag to allow legacy peer dependencies.
   * - `run`: Command to execute scripts defined in the package.json.
   */
  get cli(): PackageManagerCommands {
    return {
      install: 'install --strict-peer-dependencies=false',
      add: 'install --strict-peer-dependencies=false',
      update: 'update',
      remove: 'uninstall',
      saveFlag: '--save',
      saveDevFlag: '--save-dev',
      silentFlag: '--reporter=silent',
      legacyPeerDepsFlag: '--legacy-peer-deps',
      run: 'run',
    };
  }
}
```

## `./lib/package-managers/project.dependency.ts`

```ts
export interface ProjectDependency {
  name: string;
  version: string;
}
```

## `./lib/package-managers/yarn.package-manager.ts`

```ts
import { Runner, RunnerFactory } from '../runners';
import { YarnRunner } from '../runners/yarn.runner';
import { AbstractPackageManager } from './abstract.package-manager';
import { PackageManager } from './package-manager';
import { PackageManagerCommands } from './package-manager-commands';

export class YarnPackageManager extends AbstractPackageManager {
  /**
   * Initializes a new instance of the YarnPackageManager class.
   * @constructor
   */
  constructor() {
    super(RunnerFactory.create(Runner.YARN) as YarnRunner);
  }


  /**
   * Gets the name of the package manager.
   * @returns The name of the package manager (YARN).
   */
  public get name() {
    return PackageManager.YARN.toUpperCase();
  }

  /**
   * Provides the CLI commands specific to the Yarn package manager.
   *
   * @returns {PackageManagerCommands} An object containing the command strings for various package management actions.
   * - `install`: Command to install dependencies.
   * - `add`: Command to add a package to the dependencies.
   * - `update`: Command to upgrade dependencies.
   * - `remove`: Command to remove a package from the dependencies.
   * - `saveFlag`: Flag used to save installed packages as dependencies (empty for Yarn).
   * - `saveDevFlag`: Flag used to save installed packages as development dependencies.
   * - `silentFlag`: Flag to suppress output, setting the reporter to silent mode.
   * - `legacyPeerDepsFlag`: Flag to allow legacy peer dependencies.
   * - `run`: Command to execute scripts defined in the package.json.
   */
  get cli(): PackageManagerCommands {
    return {
      install: 'install',
      add: 'add',
      update: 'upgrade',
      remove: 'remove',
      saveFlag: '',
      saveDevFlag: '-D',
      silentFlag: '--silent',
      legacyPeerDepsFlag: '--legacy-peer-deps',
      run: 'run',
    };
  }
}
```

## `./lib/questions/questions.ts`

```ts
/**
 * Generates an input question for inquirer.js
 * @param {string} name The name of the input field
 * @param {string} message The message to display to the user
 * @returns {Function} A function that takes a default answer and returns the input question
 */
export const generateInput = (name: string, message: string): any => {
  return (defaultAnswer: string): any => ({
    type: 'input',
    name,
    message,
    default: defaultAnswer,
  });
};

/**
 * Generates a function that creates a selection prompt configuration object.
 *
 * @param name - The name of the selection prompt.
 * @returns A function that takes a message string and returns another function.
 *          This returned function takes an array of choices and returns an object
 *          representing the selection prompt configuration.
 *
 * @example
 * const selectPrompt = generateSelect('example');
 * const promptConfig = selectPrompt('Choose an option')(['Option 1', 'Option 2']);
 * // promptConfig will be:
 * // {
 * //   type: 'list',
 * //   name: 'example',
 * //   message: 'Choose an option',
 * //   choices: ['Option 1', 'Option 2']
 * // }
 */
export const generateSelect = (
  name: string,
): ((message: string) => (choices: string[]) => any) => {
  return (message: string) => {
    return (choices: string[]) => ({
      type: 'list',
      name,
      message,
      choices,
    });
  };
};
```

## `./lib/runners/abstract.runner.ts`

```ts
import * as chalk from 'chalk';
import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import { MESSAGES } from '../ui';

export class AbstractRunner {
  constructor(
    protected binary: string,
    protected args: string[] = [],
  ) { }

  public async run(
    command: string,
    collect = false,
    cwd: string = process.cwd(),
  ): Promise<null | string> {
    const args: string[] = [command];
    const options: SpawnOptions = {
      cwd,
      stdio: collect ? 'pipe' : 'inherit',
      shell: true,
    };
    return new Promise<null | string>((resolve, reject) => {
      const child: ChildProcess = spawn(
        `${this.binary}`,
        [...this.args, ...args],
        options,
      );
      if (collect) {
        child.stdout!.on('data', (data) =>
          resolve(data.toString().replace(/\r\n|\n/, '')),
        );
      }
      child.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          console.error(
            chalk.red(
              MESSAGES.RUNNER_EXECUTION_ERROR(`${this.binary} ${command}`),
            ),
          );
          reject();
        }
      });
    });
  }

  /**
   * @param command
   * @returns The entire command that will be ran when calling `run(command)`.
   */
  public rawFullCommand(command: string): string {
    const commandArgs: string[] = [...this.args, command];
    return `${this.binary} ${commandArgs.join(' ')}`;
  }
}
```

## `./lib/runners/docker.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class DockerRunner extends AbstractRunner {
  constructor() {
    super('docker');
  }
}
```

## `./lib/runners/git.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class GitRunner extends AbstractRunner {
  constructor() {
    super('git');
  }
}
```

## `./lib/runners/index.ts`

```ts
export * from './abstract.runner';
export * from './runner';
export * from './runner.factory';
```

## `./lib/runners/nestjs.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class NestJSRunner extends AbstractRunner {
  constructor() {
    super('nest');
  }
}
```

## `./lib/runners/npm.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class NpmRunner extends AbstractRunner {
  constructor() {
    super('npm');
  }
}
```

## `./lib/runners/npx.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class NpxRunner extends AbstractRunner {
  constructor() {
    super('npx');
  }
}
```

## `./lib/runners/pnpm.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class PnpmRunner extends AbstractRunner {
  constructor() {
    super('pnpm');
  }
}
```

## `./lib/runners/runner.factory.ts`

```ts
import * as chalk from 'chalk';
import { DockerRunner } from './docker.runner';
import { NestJSRunner } from './nestjs.runner';
import { NpmRunner } from './npm.runner';
import { NpxRunner } from './npx.runner';
import { PnpmRunner } from './pnpm.runner';
import { Runner } from './runner';
import { SchematicRunner } from './schematic.runner';
import { YarnRunner } from './yarn.runner';

export class RunnerFactory {
  public static create(runner: Runner) {
    switch (runner) {
      case Runner.SCHEMATIC:
        return new SchematicRunner();

      case Runner.NPM:
        return new NpmRunner();

      case Runner.YARN:
        return new YarnRunner();

      case Runner.PNPM:
        return new PnpmRunner();

      case Runner.NPX:
        return new NpxRunner();

      case Runner.DOCKER:
        return new DockerRunner();

      case Runner.NESTJS:
        return new NestJSRunner();

      default:
        console.info(chalk.yellow(`[WARN] Unsupported runner: ${runner}`));
    }
  }
}
```

## `./lib/runners/runner.ts`

```ts
export enum Runner {
  SCHEMATIC,
  NPM,
  YARN,
  PNPM,
  NPX,
  DOCKER,
  NESTJS,
  GIT,
}
```

## `./lib/runners/schematic.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class SchematicRunner extends AbstractRunner {
  constructor() {
    super(`node`, [`"${SchematicRunner.findClosestSchematicsBinary()}"`]);
  }

  public static getModulePaths() {
    return module.paths;
  }

  public static findClosestSchematicsBinary(): string {
    try {
      return require.resolve(
        '@angular-devkit/schematics-cli/bin/schematics.js',
        { paths: this.getModulePaths() },
      );
    } catch {
      throw new Error("'schematics' binary path could not be found!");
    }
  }
}
```

## `./lib/runners/yarn.runner.ts`

```ts
import { AbstractRunner } from './abstract.runner';

export class YarnRunner extends AbstractRunner {
  constructor() {
    super('yarn');
  }
}
```

## `./lib/tables/abstract.table.ts`

```ts
import EventEmitter = require('events');
import { Table } from 'typeorm';
import { AbstractDatabase } from '../databases';

export class AbstractTable {
  private eventEmitter = new EventEmitter();

  constructor(
    protected db: AbstractDatabase,
    protected name: string,
    protected data: any,
  ) {
    this.data = this.validadeData(data);
  }

  on(event: string, listener: (...args: any[]) => void) {
    return this.eventEmitter.on(event, listener);
  }

  private validadeData(data: any) {
    if (!data.columns || !Array.isArray(data.columns)) {
      throw new Error('Columns are required');
    }

    for (let i = 0; i < data.columns.length; i++) {
      if (
        data.columns[i].default &&
        typeof data.columns[i].default === 'string' &&
        data.columns[i].default[0] !== "'" &&
        data.columns[i].default[data.columns[i].default.length - 1] !== "'"
      ) {
        data.columns[i].default = `'${data.columns[i].default}'`;
      }
    }

    return data;
  }

  static getColumns(data: any) {
    if (Array.isArray(data.columns)) {
      return data.columns.map((column: any) =>
        AbstractTable.getColumnOptions(column),
      );
    } else {
      return [];
    }
  }

  static getDependencies(data: any) {
    const dependencies = [];
    for (const column of AbstractTable.getColumns(data)) {
      if (column.references && column.references.table) {
        dependencies.push(column.references.table);
      }
    }
    return [...new Set(dependencies)];
  }

  static getColumnOptions(data: any) {
    switch (data.type) {
      case 'pk':
        return Object.assign({}, data, {
          name: data.name ?? 'id',
          type: 'int',
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment',
          unsigned: true,
        });
      case 'fk':
        return Object.assign({}, data, {
          type: 'int',
          unsigned: true,
          isPrimary: data?.isPrimary ?? false,
          isNullable: data?.isNullable ?? false,
        });
      case 'created_at':
      case 'updated_at':
        return Object.assign({}, data, {
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          name: data.type,
        });

      case 'deleted_at':
        return Object.assign({}, data, {
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          name: data.type,
          isNullable: true,
        });
      case 'slug':
        return Object.assign({}, data, {
          name: data.name ?? 'slug',
          type: 'varchar',
          length: 255,
          isUnique: true,
        });
      case 'order':
        return Object.assign({}, data, {
          name: data.name ?? 'order',
          type: 'int',
          default: 0,
          unsigned: true,
          comment: 'order',
        });
      default:
        return Object.assign({ type: 'varchar' }, data);
    }
  }

  static getForeignKeys(data: any) {
    return data.columns
      .filter((column: any) => column.references && column.references.table)
      .map((columnData: any) => {
        let { table, column, ...rest } = columnData.references;

        if (!Array.isArray(column)) {
          column = [column];
        }

        return {
          ...rest,
          columnNames: [columnData.name],
          referencedColumnNames: column,
          referencedTableName: table,
          onDelete: columnData.references.onDelete ?? 'NO ACTION',
        };
      });
  }

  static getIndices(data: any) {
    return (data?.indices ?? []).map((i: any) => {
      const { columns, ...rest } = i;

      return {
        ...rest,
        columnNames: columns,
      };
    });
  }

  async apply() {
    this.eventEmitter.emit('debug', {
      name: this.name,
      data: this.data,
      columns: AbstractTable.getColumns(this.data),
      dependencies: AbstractTable.getDependencies(this.data),
      foreignKeys: AbstractTable.getForeignKeys(this.data),
      indices: AbstractTable.getIndices(this.data),
    });

    const dataSource = this.db.getDataSource();
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.createTable(
      new Table({
        name: this.name,
        columns: AbstractTable.getColumns(this.data),
        foreignKeys: AbstractTable.getForeignKeys(this.data),
        indices: AbstractTable.getIndices(this.data),
      }),
      Boolean(this.data.ifNotExists),
    );
    await dataSource.destroy();
    this.eventEmitter.emit('debug', 'created successfully');
  }
}
```

## `./lib/tables/table.factory.ts`

```ts
import { AbstractDatabase } from '../databases';
import { AbstractTable } from './abstract.table';

export class TableFactory {
  public static create(db: AbstractDatabase, name: string, data: any) {
    switch (name) {
      default:
        return new AbstractTable(db, name, data);
    }
  }
}
```

## `./lib/types/add-packages-result.ts`

```ts
export type AddPackagesResult = { packagesAdded: string[] }```

## `./lib/types/column.ts`

```ts
import { Locale } from './locale';

export interface Column {
  name: string;
  type: string;
  length?: number;
  isPrimary: boolean;
  locale?: Locale;
  field?: string;
  references?: {
    table: string;
    column: string;
    onDelete: string;
  };
  isNullable?: boolean;
  inputType?: string;
  default?: any;
}
```

## `./lib/types/data-hash.ts`

```ts
export type DataHash = {
  hash: string;
};
```

## `./lib/types/data-relation.ts`

```ts
import { DataWhere } from './data-where';

export type DataRelation = {
  [key: string]: string | number | DataWhere;
};
```

## `./lib/types/data-type.ts`

```ts
import { DataHash } from './data-hash';
import { DataRelation } from './data-relation';
import { DataWhere } from './data-where';
import { Locale } from './locale';

export type DataType = {
  relations?: DataRelation[];
} & {
  [key: string]: string | number | boolean | Locale | DataWhere | DataHash;
};
```

## `./lib/types/data-where.ts`

```ts
export type DataWhere = {
  where: {
    [key: string]: string | number | boolean;
  };
};
```

## `./lib/types/env-file.ts`

```ts
export type EnvFile = {
  DB_HOST: string;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
  DB_PORT: string;
  DATABASE_URL: string;
};
```

## `./lib/types/hedhog-file.ts`

```ts
export type HedhogTableColumnLocaleCode = string;

export type HedhogTableName = string;

export type HedhogTableColumnName = string;

export type HedhogTableColumnValue = any;

export type HedhogLocaleField = {
  [key: HedhogTableColumnLocaleCode]: string;
};

export type HedhogTableColumnBase = {
  name?: string;
  length?: string;
  isNullable?: boolean;
  locale?: HedhogLocaleField;
};

export type HedhogTableColumnFkOnDelete =
  | 'CASCADE'
  | 'RESTRICT'
  | 'NO ACTION'
  | 'SET NULL';

export type HedhogTableColumnFkOnUpdate = HedhogTableColumnFkOnDelete;

export type HedhogTableColumn = (
  | {
      type: 'pk';
    }
  | {
      type: 'fk';
      references: {
        table: string;
        column: string;
        onDelete?: HedhogTableColumnFkOnDelete;
        onUpdate?: HedhogTableColumnFkOnUpdate;
      };
    }
  | {
      type: 'slug';
    }
  | {
      type: 'enum';
      enum: string[];
    }
  | {
      type: 'created_at';
    }
  | {
      type: 'updated_at';
    }
  | {
      type: 'varchar';
    }
  | {
      type: 'datetime';
    }
  | {
      type: 'array';
      of: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'time';
    }
  | {
      type: 'order';
    }
  | {
      type: 'int';
    }
  | {
      type: 'text';
    }
  | {
      type: 'boolean';
    }
  | {
      type: 'char';
    }
  | {
      type: 'decimal';
      precision: number;
      scale: number;
    }
  | {
      type: 'tinyint';
    }
  | {
      type: 'json';
    }
) &
  HedhogTableColumnBase;

export type HedhogTable = {
  columns: HedhogTableColumn[];
  indices?: {
    columns: string[];
    isUnique?: boolean;
  }[];
  ifNotExists?: boolean;
};

export type HedhogData = {
  [key: HedhogTableColumnName]: HedhogTableColumnValue;
};

export type HedhogFieldWhere = {
  where: Record<string, HedhogTableColumnValue>;
};

export type HedhogDataColumnForeignKey =
  | number
  | string
  | null
  | HedhogFieldWhere;

export type HedhogDataMenuRelations = {
  [key: HedhogTableName]: HedhogFieldWhere[];
};

export type HedhogMenu = {
  menu_id?: HedhogDataColumnForeignKey;
  name: HedhogLocaleField;
  icon: string;
  url: string;
  slug: string;
  relations?: HedhogDataMenuRelations;
};

export type HedhogScreenRelation = {
  title: HedhogLocaleField;
};

export type HedhogScreen = {
  title: HedhogLocaleField;
  menu?: HedhogMenu;
  relations?: Record<HedhogTableName, HedhogScreenRelation>;
};

export type HedhogRoute = {
  path: string;
  lazy?: {
    component: string;
  };
  children?: HedhogRoute[];
};

export type HedhogEnum = {
  key: string;
  value: string;
};

export type HedhogFile = {
  tables?: Record<HedhogTableName, HedhogTable>;
  data?: Record<HedhogTableName, HedhogData[]>;
  screens?: Record<string, HedhogScreen>;
  routes?: HedhogRoute[];
  enums?: Record<HedhogTableName, HedhogEnum>;
};
```

## `./lib/types/locale.ts`

```ts
export type Locale = {
  [key: string]: string;
};
```

## `./lib/types/menu.ts`

```ts
import { Locale } from './locale';

export type Menu = {
  url: string;
  icon: string;
  name: Locale;
  slug: string;
  order?: string;
  menus?: Menu[];
  menu_id?: number | null | Partial<Menu>;
  relations?: any;
};
```

## `./lib/types/query-option.ts`

```ts
export type QueryOption = {
  returning?: string[] | string;
  primaryKeys?: string[] | string;
};
```

## `./lib/types/relation-n2n-result.ts`

```ts
export type RelationN2NResult = {
  tableNameIntermediate: string;
  columnNameOrigin: string;
  columnNameDestination: string;
  primaryKeyDestination: string;
};
```

## `./lib/types/route.ts`

```ts
type Route = {
  url: string;
  method: string;
};
```

## `./lib/types/screen.ts`

```ts
import { Locale } from './locale';

export type Screen = {
  slug: string;
  icon: string;
  name: Locale;
  description: Locale;
};
```

## `./lib/types/table.ts`

```ts
import { Column } from './column';

export interface Table {
  name: string;
  columns: Column[];
  ifNotExists: boolean;
}
```

## `./lib/types/transaction-queries.ts`

```ts
import { QueryOption } from './query-option';

export type TransactionQueries = {
  query: string;
  values?: any[];
  options?: QueryOption;
};
```

## `./lib/ui/banner.ts`

```ts
import chalk = require('chalk');

export const BANNER: string = chalk.gray(`
+------------------------------------------+
|                                          |
|    ${chalk.yellow(` _   _          _ _   _`)}               |
|    ${chalk.yellow(`| | | |        | | | | |`)}              |
|    ${chalk.yellow(`| |_| | ___  __| | |_| | ___   __ _`)}   |
|    ${chalk.yellow(`|  _  |/ _ \/ _ \` |  _  |/ _ \ / _ \` |`)}  |
|    ${chalk.yellow(`| | | |  __/ (_| | | | | (_) | (_| |`)}  |
|    ${chalk.yellow(`\\_| |_/\\___|\\__,_\\_| |_/\\___/ \\__  |`)}  |
|                                 ${chalk.yellow(` __/  |`)}  |
|                                 ${chalk.yellow(`|____/ `)}  |
|                                          |
+------------------------------------------+

`);
```

## `./lib/ui/emojis.ts`

```ts
import { get } from 'node-emoji';

export const EMOJIS = {
  HEART: get('heart'),
  COFFEE: get('coffee'),
  BEER: get('beer'),
  BROKEN_HEART: get('broken_heart'),
  CRYING: get('crying_cat_face'),
  HEART_EYES: get('heart_eyes_cat'),
  JOY: get('joy_cat'),
  KISSING: get('kissing_cat'),
  SCREAM: get('scream_cat'),
  ROCKET: get('rocket'),
  SMIRK: get('smirk_cat'),
  RAISED_HANDS: get('raised_hands'),
  POINT_RIGHT: get('point_right'),
  ZAP: get('zap'),
  BOOM: get('boom'),
  PRAY: get('pray'),
  WINE: get('wine_glass'),
  HEDGEHOG: get('hedgehog'),
  CONFIG: get('gear'),
  WARNING: get('warning'),
  FIRE: get('fire'),
  OK: get('ok'),
  CHECK: get('white_check_mark'),
  ERROR: get('x'),
  FIND: get('mag'),
};
```

## `./lib/ui/errors.ts`

```ts
// tslint:disable:max-line-length

export const CLI_ERRORS = {
  MISSING_TYPESCRIPT: (path: string) =>
    `Could not find TypeScript configuration file "${path}". Please, ensure that you are running this command in the appropriate directory (inside Nest workspace).`,
  WRONG_PLUGIN: (name: string) =>
    `The "${name}" plugin is not compatible with Nest CLI. Neither "after()" nor "before()" nor "afterDeclarations()" function have been provided.`,
};
```

## `./lib/ui/index.ts`

```ts
export * from './banner';
export * from './emojis';
export * from './errors';
export * from './messages';
export * from './prefixes';
```

## `./lib/ui/messages.ts`

```ts
import * as chalk from 'chalk';
import { EMOJIS } from './emojis';

export const MESSAGES = {
  PROJECT_SELECTION_QUESTION: 'Which project would you like to generate to?',
  LIBRARY_PROJECT_SELECTION_QUESTION:
    'Which project would you like to add the library to?',
  DRY_RUN_MODE: 'Command has been executed in dry run mode, nothing changed!',
  PROJECT_INFORMATION_START: `${EMOJIS.ZAP}  We will scaffold your app in a few seconds..`,
  RUNNER_EXECUTION_ERROR: (command: string) =>
    `\nFailed to execute command: ${command}`,
  PACKAGE_MANAGER_QUESTION: `Which package manager would you ${EMOJIS.HEART}  to use?`,
  PACKAGE_MANAGER_INSTALLATION_IN_PROGRESS: `Installation in progress... ${EMOJIS.COFFEE}`,
  PACKAGE_MANAGER_UPDATE_IN_PROGRESS: `Installation in progress... ${EMOJIS.COFFEE}`,
  PACKAGE_MANAGER_UPGRADE_IN_PROGRESS: `Installation in progress... ${EMOJIS.COFFEE}`,
  PACKAGE_MANAGER_PRODUCTION_INSTALLATION_IN_PROGRESS: `Package installation in progress... ${EMOJIS.COFFEE}`,
  GIT_INITIALIZATION_ERROR: 'Git repository has not been initialized',
  PACKAGE_MANAGER_INSTALLATION_SUCCEED: (name: string) =>
    name !== '.'
      ? `${EMOJIS.CHECK}  Successfully created project ${chalk.green(name)}`
      : `${EMOJIS.CHECK}  Successfully created a new project`,
  ADD_MODULE_SUCCEED: (name: string) =>
    name !== '.'
      ? `${EMOJIS.HEDGEHOG}  Successfully added ${chalk.green(name)} module`
      : `${EMOJIS.HEDGEHOG}  Successfully added a new module`,
  CONFIG_DATABASE: `${EMOJIS.CONFIG}  Configure your database connection in ${chalk.green('.env')} file`,
  GET_STARTED_INFORMATION: `${EMOJIS.POINT_RIGHT}  Get started with the following commands:`,
  RUN_MIGRATE_COMMAND: `$ npm run migrate:up`,
  CHANGE_DIR_COMMAND: (name: string) => `$ cd ${name}`,
  START_COMMAND: (name: string) => `$ ${name} run dev`,
  PACKAGE_MANAGER_INSTALLATION_FAILED: (commandToRunManually: string) =>
    `${EMOJIS.SCREAM}  Packages installation failed!\nIn case you don't see any errors above, consider manually running the failed command ${commandToRunManually} to see more details on why it errored out.`,
  // tslint:disable-next-line:max-line-length
  HEDHOG_INFORMATION_PACKAGE_MANAGER_FAILED: `${EMOJIS.SMIRK}  cannot read your project package.json file, are you inside your project directory?`,
  HEDHOG_INFORMATION_PACKAGE_WARNING_FAILED: (dependencies: string[]) =>
    `${EMOJIS.SMIRK
    }  failed to compare dependencies versions, please check that following packages are in the same minor version : \n ${dependencies.join(
      '\n',
    )}`,

  LIBRARY_INSTALLATION_FAILED_BAD_PACKAGE: (name: string) =>
    `Unable to install library ${name} because package did not install. Please check package name.`,
  LIBRARY_INSTALLATION_FAILED_NO_LIBRARY: 'No library found.',
  LIBRARY_INSTALLATION_STARTS: 'Starting library setup...',
};
```

## `./lib/ui/prefixes.ts`

```ts
import * as chalk from 'chalk';

export const ERROR_PREFIX = chalk.bgRgb(210, 0, 75).bold.rgb(0, 0, 0)(
  ' Error ',
);
export const INFO_PREFIX = chalk.bgRgb(60, 190, 100).bold.rgb(0, 0, 0)(
  ' Info ',
);
```

## `./lib/utils/add-routes-yaml.ts`

```ts
import { join } from 'node:path';
import { HedhogFile, Route } from '../classes/HedHogFile';
import { Menu } from '../types/menu';
import { Screen } from '../types/screen';

/**
 * Adds routes, menus, and screens to the `hedhog.yaml` file for a specific table.
 *
 * This function updates the `hedhog.yaml` file by adding routes, menus, and screens
 * for the specified table. If relations are provided, it associates the routes with
 * the related table.
 *
 * @param {string} libraryPath - The path to the library directory where the `hedhog.yaml` file is located.
 * @param {string} tableName - The name of the table for which routes, menus, and screens are to be added.
 * @param {string} [hasRelationsWith] - Optional. The name of the related table to associate with the routes.
 *
 * @returns {Promise<void>} - A promise that resolves when the YAML file is successfully updated, or rejects with an error.
 */
export const addRoutesToYaml = async (
  libraryPath: string,
  tableName: string,
  hasRelationsWith?: string,
): Promise<void> => {
  try {
    const filePath = join(libraryPath, '..', 'hedhog.yaml');
    const hedhogFile = await new HedhogFile().load(filePath);

    const table = hedhogFile.getTable(tableName);
    const { data } = hedhogFile;

    const primaryKeys = table.columns.filter(
      (column) => column.type === 'pk' || column.isPrimary,
    );

    const primaryKey = primaryKeys.length ? primaryKeys[0].name : 'id';

    const relations = {
      role: [
        {
          where: {
            slug: 'admin',
          },
        },
      ],
    };

    if (!data.route) {
      data.route = [];
    }

    const newRoutes: Route[] = hasRelationsWith
      ? [
        {
          url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}`,
          method: 'GET',
          relations,
        },
        {
          url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}/:${primaryKey}`,
          method: 'GET',
          relations,
        },
        {
          url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}`,
          method: 'POST',
          relations,
        },
        {
          url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}/:${primaryKey}`,
          method: 'PATCH',
          relations,
        },
        {
          url: `/${hasRelationsWith.toKebabCase()}/:${hasRelationsWith.toCamelCase()}Id/${tableName.toKebabCase()}`,
          method: 'DELETE',
          relations,
        },
      ]
      : [
        { url: `/${tableName.toKebabCase()}`, method: 'GET', relations },
        { url: `/${tableName.toKebabCase()}`, method: 'POST', relations },
        {
          url: `/${tableName.toKebabCase()}/:${primaryKey}`,
          method: 'GET',
          relations,
        },
        {
          url: `/${tableName.toKebabCase()}/:${primaryKey}`,
          method: 'PATCH',
          relations,
        },
        {
          url: `/${tableName.toKebabCase()}`,
          method: 'DELETE',
          relations,
        },
      ];

    for (const route of newRoutes) {
      if (
        !data.route.some(
          (r: any) => r.url === route.url && r.method === route.method,
        )
      ) {
        data.route.push(route);
      }
    }

    if (!data.menu) {
      data.menu = [];
    }

    const newMenus: Menu[] = [
      {
        name: {
          en: tableName.toPascalCase(),
          pt: tableName.toPascalCase(),
        },
        icon: 'file',
        url: `/${tableName.toKebabCase()}`,
        slug: tableName.toKebabCase(),
        relations,
      },
    ];

    for (const menu of newMenus) {
      if (!data.menu.some((m: any) => m.slug === menu.slug)) {
        data.menu.push(menu);
      }
    }

    if (!data.screen) {
      data.screen = [];
    }

    const newScreens: Screen[] = [
      {
        name: {
          en: tableName.toPascalCase(),
          pt: tableName.toPascalCase(),
        },
        slug: tableName.toKebabCase(),
        description: {
          en: `Screen to manage ${tableName}`,
          pt: `Tela para gerenciar ${tableName}`,
        },
        icon: 'file',
      },
    ];

    for (const screen of newScreens) {
      if (!data.screen.some((s: any) => s.slug === screen.slug)) {
        data.screen.push(screen);
      }
    }

    hedhogFile.data = data;

    await hedhogFile.save();

    console.info(`Routes added to ${filePath}`);
  } catch (error) {
    console.error('Error processing the YAML file:', error);
  }
};
```

## `./lib/utils/apply-foreign-key.ts`

```ts
async function applyForeignKey(
  db: any,
  tableName: string,
  foreignTableName: string,
) {
  const query = `
      SELECT
        kcu.column_name,
        tc.constraint_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM
        information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE
        tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = ?;
    `;

  await db.query(query, [tableName]);

  const applyForeignKeyQuery = `
      ALTER TABLE ${tableName}
      ADD CONSTRAINT fk_${tableName}_${foreignTableName}
      FOREIGN KEY (${tableName}_id)
      REFERENCES ${foreignTableName} (id);
    `;

  try {
    await db.query(applyForeignKeyQuery);
  } catch (error) {
    console.error('Error applying foreign key:', error);
  }
}
```

## `./lib/utils/check-is-git-repository.ts`

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as ora from 'ora';

export async function checkIsGitRepository(path: string, silient = false) {
  let spinner;
  if (!silient) {
    spinner = ora('Checking if is a git repository...').start();
  }
  try {
    const isGitRepository = existsSync(join(path, '.git'));
    if (!isGitRepository) {
      throw new Error('This is not a git repository.');
    }
    if (spinner) {
      spinner.succeed('This is a git repository.');
    }
    return true;
  } catch (error) {
    if (spinner) {
      spinner.fail('This is not a git repository.');
    }
    return false;
  }
}
```

## `./lib/utils/checkVersion.ts`

```ts
import chalk = require('chalk');
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { version } from '../../package.json';
import { getNpmPackage } from './get-npm-package';

const filePath = join(tmpdir(), 'hedhog-cli');

export const checkOnlineVersion = async () => {
  try {
    const currentVersion = version;

    const {
      'dist-tags': { latest: latestVersion },
    } = await getNpmPackage('@hedhog/cli');

    if (currentVersion === latestVersion) {
      await mkdirRecursive(filePath);
      await writeFile(join(filePath, '.latestVersion'), latestVersion);
    }
  } catch (error) {
    console.error('Failed to check online version', error);
  }
};

export const mkdirRecursive = async (dir: string) => {
  const parts = dir.split(sep);
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join(sep);

    if (!existsSync(path)) {
      await mkdir(path);
    }
  }
};

export const checkVersion = async () => {
  const currentVersion = version;
  if (existsSync(join(filePath, '.latestVersion'))) {
    const latestVersion = await readFile(
      join(filePath, '.latestVersion'),
      'utf-8',
    );

    const currentVersionParts = currentVersion.split('.');
    const latestVersionParts = latestVersion.split('.');
    let isLatest = true;

    for (let i = 0; i < currentVersionParts.length; i++) {
      if (parseInt(currentVersionParts[i]) < parseInt(latestVersionParts[i])) {
        isLatest = false;
        break;
      }
    }

    if (!isLatest) {
      console.info();
      console.info(
        chalk.yellow(
          `A new version of Hedhog CLI is available! ${latestVersion} (current: ${currentVersion})`,
        ),
      );
      console.info();
      console.info(chalk.white('Run the following command to update:'));
      console.info();
      console.info(chalk.gray('$ npm i -g @hedhog/cli'));
      console.info();
      console.info();
    }
  }

  checkOnlineVersion();
};
```

## `./lib/utils/convert-string-cases.ts`

```ts
export function toCamelCase(str: string): string {
  console.warn('toCamelCase is deprecated. Use toPascalCase instead.');
  return str.toCamelCase();
}

export function toSnakeCase(str: string): string {
  console.warn('toSnakeCase is deprecated. Use toKebabCase instead.');
  return str.toSnakeCase();
}

export function toKebabCase(str: string): string {
  console.warn('toKebabCase is deprecated. Use toKebabCase instead.');
  return str.toKebabCase();
}

export function toPascalCase(str: string): string {
  console.warn('toPascalCase is deprecated. Use toPascalCase instead.');
  return str.toPascalCase();
}

export function toObjectCase(value: string) {
  return {
    value,
    camel: value.toCamelCase(),
    snake: value.toSnakeCase(),
    kebab: value.toKebabCase(),
    pascal: value.toPascalCase(),
    screamingSnake: value.toScreamingSnakeCase(),
  };
}

export function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

## `./lib/utils/create-openia-assistent.ts`

```ts
import { AssistantCreateParams } from 'openai/resources/beta/assistants';
import { getOpenIAClient } from './get-openia-client';

export const createOpenIAAssistent = async ({
  model = 'gpt-4o-mini',
  description,
  instructions,
  name,
  response_format,
}: AssistantCreateParams) => {
  const client = await getOpenIAClient();

  const assistant = await client.beta.assistants.create({
    model,
    description,
    instructions,
    name,
    response_format,
  });

  return assistant;
};
```

## `./lib/utils/create-prisma-schema.ts`

```ts
import { writeFile } from 'fs/promises';
import { join } from 'node:path';
import { mkdirRecursive } from './checkVersion';

export async function createPrismaSchema(
  path: string,
  type: 'postgres' | 'mysql',
) {
  await mkdirRecursive(path);

  const prismaSchemaContent = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${type === 'mysql' ? 'mysql' : 'postgresql'}"
  url      = env("DATABASE_URL")
}`;

  await writeFile(join(path, 'schema.prisma'), prismaSchemaContent, 'utf-8');
}
```

## `./lib/utils/create-yaml.ts`

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { HedhogFile } from '../types/hedhog-file';
import { formatWithPrettier } from './format-with-prettier';
import { writeHedhogFile } from './write-hedhog-file';
import path = require('node:path');

/**
 * Creates a basic `hedhog.yaml` file in the given library path if it does not
 * exist. The created file contains some basic route and table definitions for
 * demonstration purposes.
 *
 * @param {string} libraryPath - The path to the library directory where the
 *   `hedhog.yaml` file should be created.
 * @returns {Promise<void>} - A promise that resolves when the file is created.
 */
export async function createYaml(libraryPath: string): Promise<void> {
  await mkdir(libraryPath, { recursive: true });

  const yamlContent = `
data: # Application-specific data definitions
  route: # List of API routes
    - url: /auth/login # Endpoint for user login
      method: POST # HTTP method for the endpoint
    - url: /post # Endpoint for retrieving blog posts
      method: GET # HTTP method for the endpoint
    - url: /post/:id # Endpoint for retrieving a specific post by ID
      method: GET # HTTP method for the endpoint

tables: # Definitions for database tables
  # Table 1 - Authors
  author:
    columns:
      - type: pk # Type PK creates a primary key called id
      - name: name # Column's default values are: type varchar, length 255 and not null
      - name: email # Author's email
    ifNotExists: true # Create this table only if it does not exist

  # Table 2 - Categories
  category:
    columns:
      - type: pk # Indicates this is a primary key
      - type: slug
      - type: created_at
      - type: updated_at
    ifNotExists: true # Create this table only if it does not exist

  category_locale:
    columns:
    - name: category_id
      type: fk
      isPrimary: true
      references:
          table: category
          column: id
          onDelete: RESTRICT
    - name: locale_id
      type: fk
      isPrimary: true
      references:
          table: locale
          column: id
          onDelete: RESTRICT
    - name: name
      length: 100
    - name: description
      length: 512
    - type: created_at
    - type: updated_at

  # Table 3 - Posts
  post:
    columns:
      - type: pk # Indicates this is a primary key
      - name: title # Title of the post
      - name: content # Content of the post
        type: text # Text data type for large content
      - name: author_id # Foreign key referencing the author
        type: fk # Foreign key type
        references:
          table: author # References the 'authors' table
          column: id # References the 'id' column in 'authors'
          onDelete: CASCADE # Deletes posts if the related author is deleted
      - name: category_id # Foreign key referencing the category
        type: fk # Foreign key type
        references:
          table: category # References the 'categories' table
          column: id # References the 'id' column in 'categories'
          onDelete: RESTRICT # Prevents deletion of categories if posts are associated
      - type: created_at # Timestamp for when the post was created
      - type: updated_at # Timestamp for when the post was last updated
    ifNotExists: true # Create this table only if it does not exist


  `.trim();

  const yamlFilePath = path.join(libraryPath, `hedhog.yaml`);

  await writeFile(
    yamlFilePath,
    await formatWithPrettier(yamlContent, {
      parser: 'yaml',
    }),
  );
}
```

## `./lib/utils/debug.ts`

```ts
import chalk = require('chalk');

/**
 * Logs debug information to the console with the DEBUG label.
 * @param args The arguments to be logged as debug information.
 * @returns {void} None
 */
export const debug = (...args: any[]): void => {
  console.info(chalk.yellow('DEBUG'), ...args);
};
```

## `./lib/utils/drop-openia-assistent.ts`

```ts
import { AssistantDeleted } from 'openai/resources/beta/assistants';
import { getOpenIAClient } from './get-openia-client';

/**
 * @description Deletes an OpenIA assistant by its ID.
 *
 * @param {string} id - The unique identifier of the assistant to be deleted.
 * @returns {Promise <AssistantDeleted & { _request_id?: string | null }>} - A promise that resolves with the result of the deletion operation.
 */
export const dropOpenIAAssistent = async (
  id: string,
): Promise<
  AssistantDeleted & {
    _request_id?: string | null;
  }
> => {
  const client = await getOpenIAClient();

  const assistant = await client.beta.assistants.del(id);

  return assistant;
};
```

## `./lib/utils/env-file-template.ts`

```ts
/**
 * Generates an environment file template for database configuration.
 *
 * @param type - The type of database to use, either 'postgres' or 'mysql'. Defaults to 'postgres'.
 * @returns {string} A string representing the contents of an environment (.env) file,
 *          including database type, host, port, username, password, database name,
 *          and a full database URL.
 */
export const getEnvFileTemplate = (
    type: 'postgres' | 'mysql' = 'postgres',
): string => `
DB_TYPE=${type}
DB_HOST=localhost
DB_PORT=${type === 'postgres' ? 5432 : 3306}
DB_USERNAME=hedhog
DB_PASSWORD=changeme
DB_DATABASE=hedhog

DATABASE_URL=\${DB_TYPE}://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_DATABASE}
`;
```

## `./lib/utils/execute-query-database.ts`

```ts
import { FieldPacket } from 'mysql2';
import { QueryResult } from 'typeorm';

/**
 * Execute a SQL query on a database.
 *
 * @param {string} type The type of database. Either 'postgres' or 'mysql'.
 * @param {string} host The hostname of the database.
 * @param {number} port The port number of the database.
 * @param {string} user The username to use to connect to the database.
 * @param {string} password The password to use to connect to the database.
 * @param {string} database The name of the database to use.
 * @param {string} query The SQL query to execute.
 *
 * @returns {Promise<import('pg').QueryResult | import('mysql2').RowDataPacket[][] | boolean | [QueryResult, FieldPacket[]]>}
 *   The result of the query if the query was successful, otherwise false.
 */
export async function executeQueryDatabase(
  type: 'postgres' | 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
  query: string,
): Promise<import('pg').QueryResult | import('mysql2').RowDataPacket[][] | boolean | [QueryResult, FieldPacket[]]> {
  try {
    if (type === 'postgres') {
      const { Client } = await import('pg');
      const client = new Client({
        host,
        user,
        password,
        database,
        port,
      });
      await client.connect();
      const result = await client.query(query);
      await client.end();
      return result;
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host,
        user,
        password,
        database,
        port,
      });
      const result = await connection.query(query) as unknown as [QueryResult, FieldPacket[]];
      await connection.end();
      return result;
    }
  } catch (error) {
    return false;
  }
  return true;
}
```

## `./lib/utils/filter-screen-creation.ts`

```ts
import { loadHedhogFile } from './load-hedhog-file';
import path = require('node:path');

/**
 * Checks if a screen should be created based on the presence of the table name
 * in the `screens` object in the `hedhog.yaml` file and the task condition
 * provided as an argument. If the task condition is not provided, it is
 * considered to be false.
 * @param libraryPath the path to the library directory
 * @param tableName the name of the table to check
 * @param task the task object to check the condition from
 * @returns true if the screen should be created, false otherwise
 */
export const filterScreenCreation = async (
  libraryPath: string,
  tableName: string,
  task?: any,
): Promise<boolean> => {
  const hedhogFilePath = path.join(libraryPath, '..', 'hedhog.yaml');
  const hedhogFile = await loadHedhogFile(hedhogFilePath);
  const taskCondition = !task ? false : task.subPath === 'react-query';
  return (
    (hedhogFile.screens &&
      Object.keys(hedhogFile.screens).includes(tableName)) ||
    taskCondition
  );
};
```

## `./lib/utils/format-typescript-code.ts`

```ts
import { format, Options } from 'prettier';

/**
 * Formats the given TypeScript code with Prettier.
 *
 * @param {string} code - The code to be formatted.
 * @param {import('prettier').Options} [options] - Optional options to be passed to Prettier.
 * @returns {Promise<string>} Returns the formatted code as a string.
 */
export async function formatTypeScriptCode(
  code: string,
  options: Options = {},
): Promise<string> {
  return format(code, {
    parser: 'typescript',
    ...options,
  });
}
```

## `./lib/utils/format-with-prettier.ts`

```ts
import { format, Options } from 'prettier';

/**
 * Formats the given code with prettier.
 *
 * @param {string} code - The code to be formatted.
 * @param {import('prettier').Options} [options] - Optional options to be passed to prettier.
 * @returns {Promise<string>} Returns the formatted code as a string.
 */
export async function formatWithPrettier(code: string, options: Options = {}): Promise<string> {
  return format(code, {
    ...options,
  });
}
```

## `./lib/utils/formatting.ts`

```ts
import { Runner, RunnerFactory } from '../runners';

/**
 *
 * @param str
 * @returns formated string
 * @description normalizes input to supported path and file name format.
 * Changes camelCase strings to kebab-case, replaces spaces with dash and keeps underscores.
 * @returns {string}
 */
export function normalizeToKebabOrSnakeCase(str: string): string {
  const STRING_DASHERIZE_REGEXP = /\s/g;
  const STRING_DECAMELIZE_REGEXP = /([a-z\d])([A-Z])/g;
  return str
    .replace(STRING_DECAMELIZE_REGEXP, '$1-$2')
    .toLowerCase()
    .replace(STRING_DASHERIZE_REGEXP, '-');
}


/**
 * Capitalizes the first character of the given string.
 *
 * @param str - The string to capitalize.
 * @returns The input string with the first character capitalized.
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


/**
 * Runs prettier on the given path.
 *
 * @param {string} path - The path to a file or directory to run prettier on.
 * @returns {Promise<string|undefined|null>} Resolves when the command has finished running.
 * @description Uses the npx bin to run prettier. If npx is not available, the function will return undefined.
 */
export async function prettier(path: string): Promise<string | undefined | null> {
  const npx = RunnerFactory.create(Runner.NPX);
  return npx?.run(`prettier --write ${path}`);
}
```

## `./lib/utils/generate-random-string.ts`

```ts
/**
 * Generates a random string of the given length.
 *
 * @param {number} length the length of the string to generate
 * @returns {string} a random string of the given length
 */
export function generateRandomString(length: number): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let randomString = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    randomString += characters[randomIndex];
  }

  return randomString;
}
```

## `./lib/utils/get-config.ts`

```ts
import { access, readFile } from 'fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import chalk = require('chalk');

export const getConfig = async (path: string) => {
  const dirPath = join(homedir(), '.hedhog');
  const configPath = join(dirPath, 'config.yaml');

  try {
    await access(dirPath);
    await access(configPath);
  } catch (err) {
    chalk.red('Configuration file not found');
    return;
  }

  const content = parse(await readFile(configPath, 'utf-8'));

  const getPathValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  return getPathValue(content, path);
};
```

## `./lib/utils/get-db-type-from-connection-string.ts`

```ts
import { Database } from '../databases';

export function getDbTypeFromConnectionString(
  connectionString: string,
): Database {
  const protocol = connectionString.split(':')[0];

  switch (protocol) {
    case 'postgres':
    case 'postgresql':
      return Database.POSTGRES;
    case 'mysql':
      return Database.MYSQL;
    default:
      throw new Error(`Database type not supported: ${protocol}`);
  }
}
```

## `./lib/utils/get-default-tsconfig-path.ts`

```ts
import * as fs from 'node:fs';
import { join } from 'node:path';

const TSCONFIG_BUILD_JSON = 'tsconfig.build.json';
const TSCONFIG_JSON = 'tsconfig.json';

export function getDefaultTsconfigPath() {
  return fs.existsSync(join(process.cwd(), TSCONFIG_BUILD_JSON))
    ? TSCONFIG_BUILD_JSON
    : TSCONFIG_JSON;
}
```

## `./lib/utils/get-file-content.ts`

```ts
import * as https from 'https';

export const getFileContent = (url: string) => {
  return new Promise<any>((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = '';

        // Recebendo partes dos dados
        resp.on('data', (chunk) => {
          data += chunk;
        });

        // Quando todos os dados forem recebidos
        resp.on('end', () => {
          try {
            resolve(data);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};
```

## `./lib/utils/get-fk-locale-yaml.ts`

```ts
import { loadHedhogFile } from './load-hedhog-file';
import path = require('node:path');

async function getLocaleYaml(libraryPath: string, name: string) {
  try {
    const filePath = path.join(libraryPath, '..', 'hedhog.yaml');

    const data = await loadHedhogFile(filePath);

    const key = `${name}_locale`;

    if (data.tables?.[key]) {
      for (const column of data.tables[key].columns) {
        if (
          column &&
          'references' in column &&
          column.references.table === name
        ) {
          return column.name;
        }
      }
    }

    return '';
  } catch (e) {
    return '';
  }
}

export default getLocaleYaml;
```

## `./lib/utils/get-mysql-client.ts`

```ts
export async function getMySQLClient(envVars: Record<string, string>) {
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({
    host: envVars.DB_HOST,
    user: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_DATABASE,
    port: Number(envVars.DB_PORT),
  });

  return connection;
}
```

## `./lib/utils/get-npm-package.ts`

```ts
import * as https from 'https';

export const getNpmPackage = (packageName: string) => {
  return new Promise<any>((resolve, reject) => {
    https
      .get(`https://registry.npmjs.org/${packageName}`, (resp) => {
        let data = '';

        // Recebendo partes dos dados
        resp.on('data', (chunk) => {
          data += chunk;
        });

        // Quando todos os dados forem recebidos
        resp.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};
```

## `./lib/utils/get-openia-client.ts`

```ts
import OpenAI from 'openai';
import { getConfig } from './get-config';

export const getOpenIAClient = async () => {
  const apiKey = await getConfig('tokens.OPENIA');

  return new OpenAI({
    apiKey,
  });
};
```

## `./lib/utils/get-pg-client.ts`

```ts
export async function getPostgresClient(envVars: Record<string, string>) {
  const { Client } = await import('pg');
  const client = new Client({
    host: envVars.DB_HOST,
    user: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_DATABASE,
    port: Number(envVars.DB_PORT),
  });
  await client.connect();
  return client;
}
```

## `./lib/utils/get-root-path.ts`

```ts
import { join } from 'node:path';
import { checkIsGitRepository } from './check-is-git-repository';

export async function getRootPath(path = process.cwd()): Promise<string> {
  const isGitrepo = await checkIsGitRepository(path, true);

  if (isGitrepo) {
    return path;
  } else {
    const upPath = join(path, '..');

    if (upPath === path) {
      throw new Error('Root path not found.');
    }

    return getRootPath(join(path, '..'));
  }
}
```

## `./lib/utils/global-string.ts`

```ts
declare global {
  interface String {
    toCamelCase(): string;
    toKebabCase(): string;
    toPascalCase(): string;
    toSnakeCase(): string;
    toScreamingSnakeCase(): string;
  }
}

String.prototype.toSnakeCase = function (): string {
  return this.replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, '_')
    .toLowerCase();
};

String.prototype.toKebabCase = function (): string {
  return this.replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, '-')
    .toLowerCase();
};

String.prototype.toPascalCase = function (): string {
  return this.replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(
      /(\w)(\w*)/g,
      (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase(),
    )
    .replace(/\s+/g, '');
};

String.prototype.toCamelCase = function (): string {
  return this.replace(/[-_]+/g, ' ')
    .replace(
      /(\w)(\w*)/g,
      (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase(),
    )
    .replace(/^(\w)/, (match) => match.toLowerCase())
    .replace(/\s+/g, '');
};

String.prototype.toScreamingSnakeCase = function (): string {
  return this.toSnakeCase().toUpperCase();
};

export {};
```

## `./lib/utils/is-module-available.ts`

```ts
export function isModuleAvailable(path: string): boolean {
  try {
    require.resolve(path);
    return true;
  } catch {
    return false;
  }
}
```

## `./lib/utils/load-hedhog-file.ts`

```ts
import { existsSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { basename, join } from 'path';
import { parse } from 'yaml';
import { HedhogFile } from '../types/hedhog-file';

async function loadYaml(path: string) {
  if (!existsSync(path)) {
    return null;
  }
  const content = await readFile(path, 'utf8');
  return parse(content);
}

async function loadYamlFromDirectory(dirPath: string) {
  const items: Record<string, any> = {};
  if (existsSync(dirPath) && (await stat(dirPath)).isDirectory()) {
    const files = (await readdir(dirPath)).filter((f) => f.endsWith('.yaml'));
    for (const fileName of files) {
      const name = basename(fileName, '.yaml');
      items[name] = await loadYaml(join(dirPath, fileName));
    }
  }
  return items;
}

export async function loadHedhogFile(basePath: string): Promise<HedhogFile> {
  if (basename(basePath) === 'hedhog.yaml') {
    basePath = join(basePath, '..');
  }

  const hedgehogYaml = !basePath.includes('routes')
    ? join(basePath, 'hedhog.yaml')
    : basePath;

  const config: HedhogFile = {
    tables: {},
    data: {},
    enums: {},
    screens: {},
    routes: [],
  };

  // Arquivos simples
  const [hedhog, tables, data, screens, routes] = await Promise.all([
    loadYaml(hedgehogYaml),
    loadYaml(join(basePath, 'hedhog', 'tables.yaml')),
    loadYaml(join(basePath, 'hedhog', 'data.yaml')),
    loadYaml(join(basePath, 'hedhog', 'screens.yaml')),
    loadYaml(join(basePath, 'hedhog', 'routes.yaml')),
  ]);

  Object.assign(config, hedhog);

  if (tables?.tables) Object.assign({}, config.tables, tables.tables);
  if (data?.data) Object.assign({}, config.data, data.data);
  if (screens?.screens) Object.assign({}, config.screens, screens.screens);
  if (routes?.routes) config.routes?.push(...routes.routes);
  if (hedhog?.routes) config.routes?.push(...hedhog?.routes);

  // Pastas com múltiplos arquivos
  const [tablesDir, dataDir, screensDir, routesDir] = await Promise.all([
    loadYamlFromDirectory(join(basePath, 'hedhog', 'tables')),
    loadYamlFromDirectory(join(basePath, 'hedhog', 'data')),
    loadYamlFromDirectory(join(basePath, 'hedhog', 'screens')),
    loadYamlFromDirectory(join(basePath, 'hedhog', 'routes')),
  ]);

  // Mescla os objetos retornados das pastas
  for (const [tableName, details] of Object.entries(tablesDir)) {
    if (config.tables && details?.columns) config.tables[tableName] = details;
  }
  for (const [dataName, details] of Object.entries(dataDir)) {
    if (details && config.data) {
      config.data[dataName] = details;
    }
  }
  for (const [screenName, details] of Object.entries(screensDir)) {
    if (details && config.screens) config.screens[screenName] = details;
  }
  for (const details of Object.values(routesDir)) {
    if (details?.routes) {
      config.routes = config.routes || [];
      config.routes.push(...details.routes);
    }
  }

  return config;
}
```

## `./lib/utils/local-binaries.ts`

```ts
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { CommandLoader } from '../../commands';

const localBinPathSegments = [process.cwd(), 'node_modules', '@hedhog', 'cli'];

export function localBinExists() {
  return existsSync(join(...localBinPathSegments));
}

export function loadLocalBinCommandLoader(): typeof CommandLoader {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const commandsFile = require(posix.join(...localBinPathSegments, 'commands'));
  return commandsFile.CommandLoader;
}
```

## `./lib/utils/migrations.ts`

```ts
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { formatWithPrettier } from './format-with-prettier';
import path = require('node:path');

export async function createMigrationDirectory(
  libraryPath: string,
  tableName: string,
  fieldsInput: string,
) {
  const migrationPath = path.join(libraryPath, 'src', 'migrations');

  if (!existsSync(migrationPath)) {
    await mkdir(migrationPath, { recursive: true });
  }

  const fields = parseFields(fieldsInput);

  const migrationContent = `
import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { idColumn, timestampColumn } from '@hedhog/core';

export class Migrate implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: '${tableName}',
        columns: [
            idColumn(),
            ${fields.map((field, index) => generateColumnDefinition(field, index))},
            timestampColumn(),
            timestampColumn('updated_at'),
        ],
      })
    );
    ${generateForeignKeys(tableName, fields)}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('${tableName}');
  }
}
    `.trim();

  const migrationFilePath = path.join(migrationPath, 'index.ts');

  await writeFile(migrationFilePath, migrationContent);
  await formatWithPrettier(migrationFilePath, {
    parser: 'typescript',
  });
}

function generateColumnDefinition(field: any, index: number) {
  let columnParts: string[] = [
    `name: '${field.name}'`,
    `type: '${field.type === 'fk' ? 'int' : field.type}'`,
  ];

  if (field.type === 'fk') {
    columnParts.push('unsigned: true');
  }

  if (field.length) {
    columnParts.push(`length: '${field.length}'`);
  }

  columnParts.push(`isNullable: ${field.isNullable ? 'true' : 'false'}`);

  let column = `{
    ${columnParts.join(',\n    ')}
  }`;

  return column;
}

export function parseFields(fieldsInput: string) {
  return fieldsInput.split(',').map((field) => {
    const [name, type, lengthOrForignTable, foreignColumn] = field.split(':');
    const isOptional = name.endsWith('?');
    const fieldName = name.replace('?', '');

    return {
      name: fieldName,
      type: type || 'varchar',
      length: isNaN(Number(lengthOrForignTable)) ? null : lengthOrForignTable,
      isNullable: isOptional,
      isForeignKey: type === 'fk',
      foreignTable: isNaN(Number(lengthOrForignTable))
        ? lengthOrForignTable
        : null,
      foreignColumn: foreignColumn || null,
    };
  });
}

function generateForeignKeys(tableName: string, fields: any[]) {
  const foreignKeys = fields
    .filter((field) => field.isForeignKey)
    .map(
      (field) => `
    await queryRunner.createForeignKey(
      '${tableName}',
      new TableForeignKey({
        columnNames: ['${field.name}'],
        referencedTableName: '${field.foreignTable}',
        referencedColumnNames: ['${field.foreignColumn}'],
        onDelete: 'CASCADE',
      }),
    );`,
    )
    .join('\n');

  return foreignKeys;
}
```

## `./lib/utils/os-info.utils.ts`

```ts
export default function osName(platform: string, release: string): string {
  switch (platform) {
    case 'darwin':
      return Number(release.split('.')[0]) > 15 ? 'macOS' : 'OS X';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    case 'freebsd':
      return 'FreeBSD';
    case 'openbsd':
      return 'OpenBSD';
    case 'sunos':
      return 'Solaris';
    case 'android':
      return 'Android';
    default:
      return platform;
  }
}
```

## `./lib/utils/parse-env-file.ts`

```ts
import { existsSync, readFileSync } from "node:fs";

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    throw new Error(`Arquivo .env não encontrado no caminho: ${filePath}`);
  }

  const envContent = readFileSync(filePath, 'utf-8');
  const envVariables: Record<string, string> = {};

  envContent.split('\n').forEach((line) => {
    const [key, value] = line.split('=');

    if (key && value) {
      envVariables[key.trim()] = expandValue(value.trim(), envVariables);
    }
  });

  return envVariables;
}

function expandValue(
  value: string,
  envVariables: Record<string, string>,
): string {
  return value.replace(/\${(.*?)}/g, (_, varName) => {
    return envVariables[varName] || process.env[varName] || '';
  });
}
```

## `./lib/utils/recreate-database.ts`

```ts
export async function recreateDatabase(
  type: 'postgres' | 'postgresql' | 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
) {
  try {
    if (type === 'postgres' || type === 'postgresql') {
      const { Client } = await import('pg');
      const client = new Client({
        host,
        user,
        password,
        port,
        database,
      });
      await client.connect();
      await client.query('DROP SCHEMA public CASCADE;');
      await client.query('CREATE SCHEMA public;');
      //await client.query('GRANT ALL ON SCHEMA public TO postgres;');
      //await client.query('GRANT ALL ON SCHEMA public TO public;');
      await client.end();
      return true;
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host,
        user,
        password,
        port,
      });
      console.info('recreateDatabase', 'connected');
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\`;`);
      console.info('recreateDatabase', 'dropped');
      await connection.query(`CREATE DATABASE \`${database}\`;`);
      console.info('recreateDatabase', 'created');
      await connection.end();
      return true;
    }
  } catch (error) {
    return false;
  }
  return true;
}
```

## `./lib/utils/run-script.ts`

```ts
import chalk = require('chalk');
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../package-managers';

/**
 * Runs the given script with the given package manager.
 * If the script is not found, tries to find the package manager
 * and run the script.
 *
 * @param scriptName The name of the script to run.
 * @param directory The directory to run the script in.
 * @param collect If true, collect the output of the script
 * into a string and return it.
 * @returns The output of the script or null if the script is not found.
  */
export async function runScript(
  scriptName: string,
  directory: string,
  collect = false,
): Promise<string | null | undefined> {
  let packageManager: AbstractPackageManager;

  try {
    packageManager = await PackageManagerFactory.find();
    return packageManager.runScript(scriptName, directory, collect);
  } catch (error) {
    if (error && error.message) {
      console.error(chalk.red(error.message));
    }
  }
}
```

## `./lib/utils/save-config.ts`

```ts
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

export const saveConfig = async (config: any) => {
  const dirPath = join(homedir(), '.hedhog', 'config.yaml');
  if (!existsSync(dirPath)) {
    await writeFile(dirPath, stringify({ tokens: {} }, { indent: 2 }), 'utf-8');
  }

  const currentConfig = parse(await readFile(dirPath, 'utf-8'));

  const data = Object.assign({}, currentConfig, config);

  await writeFile(dirPath, stringify(data, { indent: 2 }), 'utf-8');

  return data;
};
```

## `./lib/utils/test-database-connection.ts`

```ts
export async function testDatabaseConnection(
  type: 'postgres' | 'mysql',
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
): Promise<boolean> {
  try {
    if (type === 'postgres') {
      const { Client } = await import('pg');
      const client = new Client({
        host,
        user,
        password,
        database,
        port,
      });
      await client.connect();
      await client.query('SELECT NOW()');
      await client.end();
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host,
        user,
        password,
        database,
        port,
      });
      await connection.query('SELECT NOW()');
      await connection.end();
    }
  } catch (error) {
    return false;
  }
  return true;
}
```

## `./lib/utils/throw-error.ts`

```ts
import chalk = require('chalk');

export const throwError = (error: string): void => {
  console.error(chalk.red(error));
};
```

## `./lib/utils/tree-kill.ts`

```ts
import { execSync } from 'child_process';

export function treeKillSync(pid: number, signal?: string | number): void {
  if (process.platform === 'win32') {
    execSync('taskkill /pid ' + pid + ' /T /F');
    return;
  }

  const childs = getAllChilds(pid);
  childs.forEach(function (pid) {
    killPid(pid, signal);
  });

  killPid(pid, signal);
  return;
}

function getAllPid(): {
  pid: number;
  ppid: number;
}[] {
  const rows = execSync('ps -A -o pid,ppid')
    .toString()
    .trim()
    .split('\n')
    .slice(1);

  return rows
    .map(function (row) {
      const parts = row.match(/\s*(\d+)\s*(\d+)/);

      if (parts === null) {
        return null;
      }

      return {
        pid: Number(parts[1]),
        ppid: Number(parts[2]),
      };
    })
    .filter(<T>(input: null | undefined | T): input is T => {
      return input != null;
    });
}

function getAllChilds(pid: number) {
  const allpid = getAllPid();

  const ppidHash: {
    [key: number]: number[];
  } = {};

  const result: number[] = [];

  allpid.forEach(function (item) {
    ppidHash[item.ppid] = ppidHash[item.ppid] || [];
    ppidHash[item.ppid].push(item.pid);
  });

  const find = function (pid: number) {
    ppidHash[pid] = ppidHash[pid] || [];
    ppidHash[pid].forEach(function (childPid) {
      result.push(childPid);
      find(childPid);
    });
  };

  find(pid);
  return result;
}

function killPid(pid: number, signal?: string | number) {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if (err.code !== 'ESRCH') {
      throw err;
    }
  }
}
```

## `./lib/utils/update-files.ts`

```ts
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
```

## `./lib/utils/validade-directory.ts`

```ts
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function validateDirectory(dirPath: string): boolean {
  if (existsSync(dirPath)) {
    return true;
  }

  const parentDir = dirname(dirPath);

  mkdirSync(dirPath, { recursive: true });

  if (existsSync(parentDir)) {
    return true;
  } else {
    return false;
  }
}
```

## `./lib/utils/write-hedhog-file.ts`

```ts
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { stringify } from 'yaml';
import { HedhogFile } from '../types/hedhog-file';

export const writeHedhogFile = async (
  basePath: string,
  content: HedhogFile,
) => {
  if (basename(basePath) === 'hedhog.yaml') {
    basePath = join(basePath, '..');
  }

  const props: (keyof HedhogFile)[] = ['tables', 'data', 'screens', 'enums'];

  for (const prop of props) {
    if (content?.[prop]) {
      for (const itemName of Object.keys(content[prop]!)) {
        if (existsSync(join(basePath, 'hedhog', prop, `${itemName}.yaml`))) {
          await writeFile(
            join(basePath, 'hedhog', prop, `${itemName}.yaml`),
            stringify((content[prop] as Record<string, any>)[itemName] ?? ''),
            'utf8',
          );

          delete (content[prop] as Record<string, any>)[itemName];
        }
      }
    }
  }

  for (const prop of props) {
    if (existsSync(join(basePath, 'hedhog', `${prop}.yaml`)) && content[prop]) {
      await writeFile(
        join(basePath, 'hedhog', `${prop}.yaml`),
        stringify(content[prop]),
        'utf8',
      );

      delete content[prop];
    }
  }

  if (existsSync(join(basePath, 'hedhog', `routes.yaml`)) && content.routes) {
    await writeFile(
      join(basePath, 'hedhog', 'routes.yaml'),
      stringify(content.routes),
      'utf8',
    );

    delete content.routes;
  }

  for (const prop of props) {
    if (Object.keys(content[prop] ?? {}).length === 0) {
      delete content[prop];
    }
  }

  if ((content.routes ?? []).length === 0) {
    delete content.routes;
  }

  if (
    Object.keys(content.data ?? {}).length > 0 ||
    Object.keys(content.tables ?? {}).length > 0 ||
    Object.keys(content.screens ?? {}).length > 0 ||
    Object.keys(content.enums ?? {}).length > 0 ||
    (content.routes ?? []).length > 0
  ) {
    await writeFile(join(basePath, 'hedhog.yaml'), stringify(content), 'utf8');
  }

  return true;
};
```

## `./scripts/deploy.ts`

```ts
import { execSync } from 'child_process';

/**
 * Runs the given command and throws an error if it fails.
 *
 * @param command The command to run.
 * @returns The result of running the command.
 */
function runCommand(command: string) {
  try {
    return execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    process.exit(1);
  }
}

/**
 * Deploy the CLI to the production branch.
 *
 * This command verifies that there are no uncommitted changes in the
 * repository, and then performs the following steps:
 *
 * 1. Pulls the latest changes from the "master" branch of the remote
 *    repository.
 * 2. Pushes the latest changes to the "master" branch of the remote
 *    repository.
 * 3. Creates a new version of the CLI using "npm version patch", which
 *    increments the patch version and creates a new version tag.
 * 4. Verifies that the "production" branch exists, and creates it if it
 *    doesn't.
 * 5. Pulls the latest changes from the "master" branch of the remote
 *    repository.
 * 6. Pushes the latest changes to the "master" branch of the remote
 *    repository.
 * 7. Checks out the "production" branch.
 * 8. Merges the "master" branch into the "production" branch.
 * 9. Pushes the latest changes to the "production" branch of the remote
 *    repository.
 * 10. Checks out the "master" branch again.
 *
 * After completing these steps, the command prints a success message and
 * exits with a status code of 0.
 *
 * If any of the above steps fail, the command prints an error message and
 * exits with a non-zero status code.
 */
function main() {
  try {
    const gitStatus = execSync('git status -s').toString().trim();

    if (gitStatus) {
      console.error(
        '❌ O repositório possui arquivos não commitados. Por favor, realize o commit e tente novamente.',
      );
      process.exit(1);
    }

    const gitLog = execSync('git log origin/master..master').toString().trim();

    if (gitLog) {
      runCommand('git pull origin master');
      runCommand('git push origin master');
    }

    runCommand('npm version patch');

    const branches = execSync('git branch')
      .toString()
      .trim()
      .split('\n')
      .map((branch) => branch.replace('*', '').trim());

    if (!branches.includes('production')) {
      runCommand('git branch production');
    }

    runCommand('git pull origin master');
    runCommand('git push origin master');
    runCommand('git checkout production');
    runCommand('git merge master');
    runCommand('git push origin production');
    runCommand('git checkout master');

    console.info('✅ Deploy realizado com sucesso!');
  } catch (error) {
    console.error('An error occurred during deployment:', error);
    process.exit(1);
  }
}

main();
```

## `./templates/async/handlers-related.ts.ejs`

```tsx
import { useDefaultMutation } from '@/hooks/use-default-mutation'
import { useQuery } from '@tanstack/react-query'
import { requests } from './requests'

const scope = '<%= tableNameCase.kebab %>'

export function use<%= tableNameCase.pascal %>Create() {
  const { <%= tableNameCase.camel %>Create } = requests()
  return useDefaultMutation(scope, 'create', <%= tableNameCase.camel %>Create)
}

export function use<%= tableNameCase.pascal %>Delete() {
  const { <%= tableNameCase.camel %>Delete } = requests()
  return useDefaultMutation(scope, 'delete', <%= tableNameCase.camel %>Delete)
}

export function use<%= tableNameCase.pascal %>Update() {
  const { <%= tableNameCase.camel %>Update } = requests()
  return useDefaultMutation(scope, 'update', <%= tableNameCase.camel %>Update)
}

export function use<%= tableNameCase.pascal %>Get(<%= fkNameCase.camel %>: number, <%= pkNameCase.camel %>: number) {
  const { <%= tableNameCase.camel %>Get } = requests()
  return useQuery({
    queryKey: [scope, 'get'],
    queryFn: () => <%= tableNameCase.camel %>Get({<%= fkNameCase.camel %>, <%= pkNameCase.camel %>}),
  })
}
```

## `./templates/async/handlers.ts.ejs`

```tsx
import { useDefaultMutation } from '@/hooks/use-default-mutation'
import { useQuery } from '@tanstack/react-query'
import { requests } from './requests'

const scope = '<%= tableNameCase.kebab %>'

export function use<%= tableNameCase.pascal %>Create() {
  const { <%= tableNameCase.camel %>Create } = requests()
  return useDefaultMutation(scope, 'create', <%= tableNameCase.camel %>Create)
}

export function use<%= tableNameCase.pascal %>Delete() {
  const { <%= tableNameCase.camel %>Delete } = requests()
  return useDefaultMutation(scope, 'delete', <%= tableNameCase.camel %>Delete)
}

export function use<%= tableNameCase.pascal %>Update() {
  const { <%= tableNameCase.camel %>Update } = requests()
  return useDefaultMutation(scope, 'update', <%= tableNameCase.camel %>Update)
}

export function use<%= tableNameCase.pascal %>Get(id: number) {
  const { <%= tableNameCase.camel %>Get } = requests()
  return useQuery({
    queryKey: [scope, 'get'],
    queryFn: () => <%= tableNameCase.camel %>Get(id),
  })
}```

## `./templates/async/requests-related.ts.ejs`

```tsx
import { useApp } from "@/hooks/use-app";
import { Delete, PaginationParams, PaginationResult } from "@/types";
import { <%= tableNameCase.pascal %>Type } from "@/types/models";
import { HttpMethod } from "@/types/http-method";
<%- hasLocale ? "import { formatDataWithLocale } from '@hedhog/utils'" : "" %>	

export function requests() {
  const { request } = useApp();

  const <%= tableNameCase.camel %>List = async (
    <%= fkNameCase.camel %>: number,
    params: PaginationParams & { <%= pkNameCase.camel %>?: number }
  ) => {
    return request<PaginationResult<<%= tableNameCase.pascal %>Type>>({
      url: `/<%= tableNameRelatedCase.kebab %>/${<%= fkNameCase.camel %>}/<%= tableNameCase.kebab %>`,
      params,
    }).then((res) => res.data);
  };

  const <%= tableNameCase.camel %>Create = async (params: { <%= fkNameCase.camel %>: number, data: <%= tableNameCase.pascal %>Type }) => {
    const { <%= fkNameCase.camel %>, data } = params 
    
    return request<<%= tableNameCase.pascal %>Type>({
      url: `/<%= tableNameRelatedCase.kebab %>/${<%= fkNameCase.camel %>}/<%= tableNameCase.kebab %>`,
      method: HttpMethod.POST,
      data: <%= hasLocale ? 'formatDataWithLocale(data)' : 'data' %>,
    }).then((res) => res.data);
  };

  const <%= tableNameCase.camel %>Update = async (params: {
    <%= fkNameCase.camel %>: number,
    <%= pkNameCase.camel %>: number,
    data: <%= tableNameCase.pascal %>Type
  }) => {
    const { <%= fkNameCase.camel %>, <%= pkNameCase.camel %>, data } = params

    return request<<%= tableNameCase.pascal %>Type>({
      url: `/<%= tableNameRelatedCase.kebab %>/${<%= fkNameCase.camel %>}/<%= tableNameCase.kebab %>/${<%= pkNameCase.camel %>}`,
      method: HttpMethod.PATCH,
      data: <%= hasLocale ? 'formatDataWithLocale(data)' : 'data' %>,
    }).then((res) => res.data);
  };

  const <%= tableNameCase.camel %>Delete = async (params: { id: number, ids: number[] }) => {
    const { id, ids } = params
    
    return request<Delete>({
      url: `/<%= tableNameRelatedCase.kebab %>/${id}/<%= tableNameCase.kebab %>`,
      method: HttpMethod.DELETE,
      data: { ids },
    }).then((res) => res.data);
  };

  const <%= tableNameCase.camel %>Get = async (params: { <%= fkNameCase.camel %>: number, <%= pkNameCase.camel %>: number }) => {
    const { <%= fkNameCase.camel %>, <%= pkNameCase.camel %> } = params
    
    return request<<%= tableNameCase.pascal %>Type>({
      url: `/<%= tableNameRelatedCase.kebab %>/${<%= fkNameCase.camel %>}/<%= tableNameCase.kebab %>/${<%= pkNameCase.camel %>}`,
    }).then((res) => res.data);
  }

  return {
    <%= tableNameCase.camel %>Create,
    <%= tableNameCase.camel %>Update,
    <%= tableNameCase.camel %>Delete,
    <%= tableNameCase.camel %>List,
    <%= tableNameCase.camel %>Get
  };
}
```

## `./templates/async/requests.ts.ejs`

```tsx
import { useApp } from '@/hooks/use-app'
import { Delete, PaginationParams, PaginationResult } from '@/types'
import { <%= tableNameCase.pascal %> } from '@/types/models'
import { HttpMethod } from '@/types/http-method'
<%- hasLocale ? "import { formatDataWithLocale } from '@hedhog/utils'" : "" %>	

export function requests() {
  const { request } = useApp()

  const <%= tableNameCase.camel %>List = async (params: PaginationParams) => {
    return request<PaginationResult<<%= tableNameCase.pascal %>>>(
      {
        url: '/<%= tableNameCase.kebab %>',
        params
      }
    ).then((res) => res.data)
  }

  const <%= tableNameCase.camel %>Get = async (id: number) => {
    return request<<%= tableNameCase.pascal %>>(
      {
        url: `/<%= tableNameCase.kebab %>/${id}`
      }
    ).then((res) => res.data)
  }

  const <%= tableNameCase.camel %>Create = async (params: { data: <%= tableNameCase.pascal %> }) => {
    const { data } = params
    return request<<%= tableNameCase.pascal %>>(
     { 
        url: '/<%= tableNameCase.kebab %>',
        method: HttpMethod.POST,
        data: <%= hasLocale ? 'formatDataWithLocale(data)' : 'data' %>
      }
    ).then((res) => res.data)
  }

  const <%= tableNameCase.camel %>Delete = async (ids: number[]) => {
    return request<Delete>(
      {
        url: '/<%= tableNameCase.kebab %>',
        data: { ids },
        method: HttpMethod.DELETE
      }
    ).then((res) => res.data)
  }

  const <%= tableNameCase.camel %>Update = async (params: {id: number; data: <%= tableNameCase.pascal %>}) => {
    const { id, data } = params
    return request<<%= tableNameCase.pascal %>>(
      {
        url: `/<%= tableNameCase.kebab %>/${id}`,
        method: HttpMethod.PATCH,
        data: <%= hasLocale ? 'formatDataWithLocale(data)' : 'data' %>
      }
    ).then((res) => res.data)
  }

  return {
    <%= tableNameCase.camel %>Create,
    <%= tableNameCase.camel %>Update,
    <%= tableNameCase.camel %>Delete,
    <%= tableNameCase.camel %>List,
    <%= tableNameCase.camel %>Get,
  }
}
```

## `./templates/controller/controller-locale.ts.ejs`

```tsx
import { Pagination } from '@hedhog/pagination';
import { Locale } from '@hedhog/locale';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { UpdateDTO } from './dto/update.dto';
import { <%= tableNameCase.pascal %>Service } from './<%= tableNameCase.kebab %>.service';
import { Role, DeleteDTO } from '@hedhog/core';

@Role()
@Controller('<%= tableNameCase.kebab %>')
export class <%= tableNameCase.pascal %>Controller {
  constructor(
    @Inject(forwardRef(() => <%= tableNameCase.pascal %>Service))
    private readonly <%= tableNameCase.camel %>Service: <%= tableNameCase.pascal %>Service,
  ) {}

  @Get()
  async list(@Locale() locale, @Pagination() paginationParams) {
    return this.<%= tableNameCase.camel %>Service.list(locale, paginationParams);
  }

  @Get(':<%= pkNameCase.camel %>')
  async get(@Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number) {
    return this.<%= tableNameCase.camel %>Service.get(<%= pkNameCase.camel %>);
  }

  @Post()
  async create(@Body() data: CreateDTO) {
    return this.<%= tableNameCase.camel %>Service.create(data);
  }

  @Patch(':<%= pkNameCase.camel %>')
  async update(
    @Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number,
    @Body() data: UpdateDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.update({
      <%= pkNameCase.camel %>,
      data,
    });
  }

  @Delete()
  async delete(@Body() data: DeleteDTO) {
    return this.<%= tableNameCase.camel %>Service.delete(data);
  }
}```

## `./templates/controller/controller-related-locale.ts.ejs`

```tsx
import { Pagination } from '@hedhog/pagination';
import { Role } from '@hedhog/core';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Inject,
  forwardRef
} from '@nestjs/common';
import { <%= tableNameCase.pascal %>Service } from './<%= tableNameCase.kebab %>.service';
import { CreateDTO } from './dto/create.dto';
import { UpdateDTO } from './dto/update.dto';
import { DeleteDTO } from '@hedhog/core';
import { Locale } from '@hedhog/locale';	

@Role()
@Controller('<%= relatedTableNameCase.kebab %>/:<%= fkNameCase.camel %>/<%= tableNameCase.kebab %>')
export class <%= tableNameCase.pascal %>Controller {

  constructor(
    @Inject(forwardRef(() => <%= tableNameCase.pascal %>Service))
    private readonly <%= tableNameCase.camel %>Service: <%= tableNameCase.pascal %>Service
  ) {}

  @Post()
  create(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Body() data: CreateDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.create(<%= fkNameCase.camel %>, data);
  }

  @Get()
  list(
    @Locale() locale,
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Pagination() paginationParams,
  ) {
    return this.<%= tableNameCase.camel %>Service.list(locale, <%= fkNameCase.camel %>, paginationParams);
  }

  @Patch(':<%= pkNameCase.camel %>')
  update(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number,
    @Body() data: UpdateDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.update(
      <%= fkNameCase.camel %>,
      <%= pkNameCase.camel %>,
      data,
    );
  }

  @Delete()
  delete(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Body() { ids }: DeleteDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.delete(<%= fkNameCase.camel %>, { ids });
  }
}
```

## `./templates/controller/controller-related.ts.ejs`

```tsx
import { Pagination } from '@hedhog/pagination';
import { Role } from '@hedhog/core';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Inject,
  forwardRef
} from '@nestjs/common';
import { <%= tableNameCase.pascal %>Service } from './<%= tableNameCase.kebab %>.service';
import { CreateDTO } from './dto/create.dto';
import { UpdateDTO } from './dto/update.dto';
import { DeleteDTO } from '@hedhog/core';

@Role()
@Controller('<%= relatedTableNameCase.kebab %>/:<%= fkNameCase.camel %>/<%= tableNameCase.kebab %>')
export class <%= tableNameCase.pascal %>Controller {

  constructor(
    @Inject(forwardRef(() => <%= tableNameCase.pascal %>Service))
    private readonly <%= tableNameCase.camel %>Service: <%= tableNameCase.pascal %>Service
  ) {}

  @Post()
  create(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Body() data: CreateDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.create(<%= fkNameCase.camel %>, data);
  }

  @Get()
  list(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Pagination() paginationParams,
  ) {
    return this.<%= tableNameCase.camel %>Service.list(paginationParams, <%= fkNameCase.camel %>);
  }

  @Get(':<%= pkNameCase.camel %>')
  get(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number,
  ){
    return this.<%= tableNameCase.camel %>Service.get(<%= fkNameCase.camel %>, <%= pkNameCase.camel %>);
  }

  @Patch(':<%= pkNameCase.camel %>')
  update(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number,
    @Body() data: UpdateDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.update(
      <%= fkNameCase.camel %>,
      <%= pkNameCase.camel %>,
      data,
    );
  }

  @Delete()
  delete(
    @Param('<%= fkNameCase.camel %>', ParseIntPipe) <%= fkNameCase.camel %>: number,
    @Body() { ids }: DeleteDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.delete(<%= fkNameCase.camel %>, { ids });
  }
}
```

## `./templates/controller/controller.ts.ejs`

```tsx
import { Pagination } from '@hedhog/pagination';
import { Locale } from '@hedhog/locale';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { UpdateDTO } from './dto/update.dto';
import { <%= tableNameCase.pascal %>Service } from './<%= tableNameCase.kebab %>.service';
import { Role, DeleteDTO } from '@hedhog/core';

@Role()
@Controller('<%= tableNameCase.kebab %>')
export class <%= tableNameCase.pascal %>Controller {
  constructor(
    @Inject(forwardRef(() => <%= tableNameCase.pascal %>Service))
    private readonly <%= tableNameCase.camel %>Service: <%= tableNameCase.pascal %>Service,
  ) {}

  @Get()
  async list(@Pagination() paginationParams) {
    return this.<%= tableNameCase.camel %>Service.list(paginationParams);
  }

  @Get(':<%= pkNameCase.camel %>')
  async get(@Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number) {
    return this.<%= tableNameCase.camel %>Service.get(<%= pkNameCase.camel %>);
  }

  @Post()
  async create(@Body() data: CreateDTO) {
    return this.<%= tableNameCase.camel %>Service.create(data);
  }

  @Patch(':<%= pkNameCase.camel %>')
  async update(
    @Param('<%= pkNameCase.camel %>', ParseIntPipe) <%= pkNameCase.camel %>: number,
    @Body() data: UpdateDTO,
  ) {
    return this.<%= tableNameCase.camel %>Service.update({
      <%= pkNameCase.camel %>,
      data,
    });
  }

  @Delete()
  async delete(@Body() data: DeleteDTO) {
    return this.<%= tableNameCase.camel %>Service.delete(data);
  }
}```

## `./templates/custom/assistent.ejs`

```tsx
traduza para o idioma que foi pedido os valores das propriedades do arquivo JSON abaixo e antes de traduzir troque a parte <thing> pelo nome da coisa informada junto com o idioma:

    {
      "create": "Create <thing>",
      "createText": "Fill the <thing> informations.",
      "createTooltip": "Create new <thing>",
      "delete": "Delete <thing>",
      "deleteText": "Are you sure to delete these <thing>?",
      "deleteTooltip": "Delete the selected <thing>",
      "edit": "Edit <thing>",
      "editText": "View and edit <thing> information.",
      "editTooltip": "Edit the selected <thing>"
    }
    
    Responda sempre seguindo o template abaixo:
    
    {
      "create": "",
      "createText": "",
      "createTooltip": "",
      "delete": "",
      "deleteText": "",
      "deleteTooltip": ",
      "edit": "",
      "editText": "",
      "editTooltip": ""
    }```

## `./templates/custom/static-imports.ts.ejs`

```tsx
import { useApp } from '@/hooks/use-app'
import { isPlural } from '@/lib/utils'```

## `./templates/custom/static-vars.ts.ejs`

```tsx
const { openDialog, confirm, closeDialog } = useApp()
const [selectedItems, setSelectedItems] = useState<any[]>([])```

## `./templates/dto/boolean.dto.ts.ejs`

```tsx
<% if (isOptional) { %>@IsOptional()<%} %>
@IsBoolean()
<%- fieldName %><%= optionalSignal %>: boolean;```

## `./templates/dto/create.dto.ts.ejs`

```tsx
<%- imports %>
<%- hasLocale ? 'import { WithLocaleDTO } from "@hedhog/locale"' : '' %>

export class CreateDTO <%- hasLocale ? 'extends WithLocaleDTO' : '' %> {
    <%- fields %>
}```

## `./templates/dto/import.dto.ts.ejs`

```tsx
import { <%- types %> } from 'class-validator'```

## `./templates/dto/number.dto.ts.ejs`

```tsx
<% if (isOptional) { %>@IsOptional()<%} %>
@IsNumber()
<%- fieldName %><%= optionalSignal %>: number;```

## `./templates/dto/string.dto.ts.ejs`

```tsx
<% if (isOptional) { %>@IsOptional()<%} %>
@IsString()
<%- fieldName %><%= optionalSignal %>: string;```

## `./templates/dto/update.dto.ts.ejs`

```tsx
import { PartialType } from '@nestjs/mapped-types';
import { CreateDTO } from './create.dto';
    
export class UpdateDTO extends PartialType(CreateDTO) {}```

## `./templates/enum/table-enum.ejs`

```tsx
export enum <%= enumName %>Enum {
<% values.forEach(function(item) { %>
    <%= item.key %> = <%= item.value %>,
<% }); %>
}  ```

## `./templates/function/open-create.ts.ejs`

```tsx
const openCreate<%= tableNameRelatedCase.pascal %> = () => {
    const id = openDialog({
      title: t('create', { ns: '<%= libraryNameCase.kebab %>.<%= tableNameRelatedCase.kebab %>' }),
      description: t('createText', { ns: '<%= libraryNameCase.kebab %>.<%= tableNameRelatedCase.kebab %>' }),
      children: () => (
        <<%= tableNameRelatedCase.pascal %>CreatePanel id={Number(data.id)} onCreated={() => closeDialog(id)} />
      ),
    })

    return id
}```

## `./templates/function/open-delete.ts.ejs`

```tsx
const openDelete<%= tableNameRelatedCase.pascal %> = (items: <%= tableNameRelatedCase.pascal %>[]) => {
    return confirm({
      title: `${t('delete', { ns: 'actions' })} ${items.length} ${isPlural(items.length) ? t('items', { ns: 'actions' }) : t('item', { ns: 'actions' })}`,
      description: t('deleteText', { ns: '<%= libraryNameCase.snake %>.<%= tableNameRelatedCase.kebab %>' })
    })
      .then(() =>
      <%= tableNameRelatedCase.camel %>Delete({
          id: Number(data.id),
          ids: items.map((item) => item.id).filter((id) => id !== undefined)
        })
      )
      .catch(() => setSelectedItems(items));
};```

## `./templates/function/open-update.ts.ejs`

```tsx
const openUpdate<%= tableNameRelatedCase.pascal %> = (item<%= tableNameRelatedCase.pascal %>: <%= tableNameRelatedCase.pascal %>) => {
    const id = openDialog({
      children: () => (
        <<%= tableNameRelatedCase.pascal %>UpdatePanel id={Number(item?.id)} data={item<%= tableNameRelatedCase.pascal %>} onUpdated={() => closeDialog(id)} />
      ),
      title: t('edit', { ns: '<%= libraryNameCase.kebab %>.<%= tableNameRelatedCase.kebab %>' }),
      description: t('editText', { ns: '<%= libraryNameCase.kebab %>.<%= tableNameRelatedCase.kebab %>' }),
    })

    return id
}```

## `./templates/module/module-related.ts.ejs`

```tsx
<% const toPascalCase = (str) => str.replace(/(^\w|[-_]\w)/g, (match) => match.replace(/[-_]/, '').toUpperCase()) %>;
<% const toKebabCase = (str) => str.replace(/_/g, '-'); %>
<%
const moduleImports = `
import { AdminModule } from '@hedhog/admin';
import { PaginationModule } from '@hedhog/pagination';
import { PrismaModule } from '@hedhog/prisma';
import { forwardRef, Module } from '@nestjs/common';`;

let additionalImports = '';
let controllersList = '';
let providersList = '';

for (const relation of options.tablesWithRelations) {
    const pascalCaseRelation = toPascalCase(relation);
    const kebabCaseRelation = toKebabCase(relation);
    additionalImports += `
import { ${pascalCaseRelation}Controller } from './${kebabCaseRelation}/${kebabCaseRelation}.controller';
import { ${pascalCaseRelation}Service } from './${kebabCaseRelation}/${kebabCaseRelation}.service';`;
    controllersList += `${pascalCaseRelation}Controller, `;
    providersList += `${pascalCaseRelation}Service, `;
}

const ownProviderImport = `
import { ${tableNameCase.pascal}Controller } from './${tableNameCase.kebab}.controller';
import { ${tableNameCase.pascal}Service } from './${tableNameCase.kebab}.service';`;
additionalImports += ownProviderImport;

controllersList += `${tableNameCase.pascal}Controller`;
providersList += `${tableNameCase.pascal}Service`;
%>
<%- moduleImports %><%- additionalImports %>
@Module({
  imports: [
    forwardRef(() => AdminModule),
    forwardRef(() => PrismaModule),
    forwardRef(() => PaginationModule),
  ],
  controllers: [
    <%= controllersList %>
  ],
  providers: [
    <%= providersList %>
  ],
  exports: [forwardRef(() => <%= tableNameCase.pascal %>Service)],
})
export class <%= tableNameCase.pascal %>Module {}
```

## `./templates/module/module.ts.ejs`

```tsx
import { AdminModule } from '@hedhog/admin';
import { PaginationModule } from '@hedhog/pagination';
import { PrismaModule } from '@hedhog/prisma';
import { forwardRef, Module } from '@nestjs/common';
<%- module.imports.join('\n') %>

@Module({
    imports: [
        forwardRef(() => AdminModule),
        forwardRef(() => PrismaModule),
        forwardRef(() => PaginationModule),
    ],
    controllers: [<%- module.controllers.join(',') %>],
    providers: [<%- module.providers.join(',') %>],
    exports:  [<%- module.exports.join(',') %>]
})
export class <%- tableNameCase.pascal %>Module {}```

## `./templates/panel/create-panel.ts.ejs`

```tsx
import FormPanel, { FormPanelRef, <%- hasLocale ? 'getFieldsLocale,' : '' %> } from '@/components/panels/form-panel'
<% if (fields.filter(field => field.name).length) { %>import { EnumFieldType } from '@/enums/EnumFieldType'<% } %>
import { use<%= tableNameCase.pascal %>Create } from '@/features/<%= libraryName %>/<%= tableNameCase.kebab %>'
import { <%= tableNameCase.pascal %> } from '@/types/models'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export type <%= tableNameCase.pascal %>CreatePanelRef = {
    submit: () => void
}

export type <%= tableNameCase.pascal %>CreatePanelProps = {
    <% if (hasRelations) { %> id: number <% } %>
    onCreated?: (data: <%= tableNameCase.pascal %>) => void
}

const <%= tableNameCase.pascal %>CreatePanel = forwardRef(
    ({  <% if (hasRelations) { %> id, <% } %> onCreated }: <%= tableNameCase.pascal %>CreatePanelProps, ref) => {
        const formRef = useRef<FormPanelRef>(null)
        const { t } = useTranslation(['actions', 'fields', 'translations'])
        const { mutateAsync: create<%= tableNameCase.pascal %> } = use<%= tableNameCase.pascal %>Create()

        useImperativeHandle(
            ref,
            () => ({
                submit: () => {
                formRef.current?.submit()
            },
        }),
        [formRef])

        return (
            <FormPanel
                ref={formRef}
                fields={[
                    <% fields.forEach((field, index, array) => { %>
                    {
                        name: '<%= field.name %>',
                        label: { text: t('<%= tableNameCase.snake %>.<%= field.name %>', { ns: 'fields' }) },
                        type: <%- field.inputType %>,
                        required: true,
                        <% if (field.url) { %>url: '<%= field.url %>',<% } %>
                        <% if (field.displayName) { %>displayName: '<%= field.displayName %>',<% } %>
                        <% if (field.valueName) { %>valueName: '<%= field.valueName %>',<% } %>
                    }<%= index < array.length - 1 || hasLocale ? ',' : '' %>
                    <% }) %>
                    <%- hasLocale ? '...getFieldsLocale([{ name: "name" }])' : '' %>
                ]}
                button={{ text: t('create', { ns: 'actions' }) }}
                onSubmit={async (data) => {
                    const createdData = await create<%= tableNameCase.pascal %>({
                        <% if (hasRelations) { %> <%= fkNameCase.camel %>: Number(id), <% } %>
                        data
                    })
                    if (typeof onCreated === 'function') {
                        onCreated(createdData as any)
                    }
                }}
            />
        )
    }
)

<%= tableNameCase.pascal %>CreatePanel.displayName = '<%= tableNameCase.pascal %>CreatePanel'

export default <%= tableNameCase.pascal %>CreatePanel```

## `./templates/panel/tab-panel-imports.ts.ejs`

```tsx
import { <%- tableNameCase.pascal %> } from '@/types/models/<%= tableNameCase.pascal %>.ts'
import { use<%- tableNameCase.pascal %>Delete } from '@/features/<%= libraryNameCase.kebab %>/<%- tableNameCase.kebab %>'
import <%= tableNameCase.pascal %>CreatePanel from '@/pages/<%= libraryNameCase.kebab %>/<%= tableNameCase.kebab%>/components/<%= tableNameCase.kebab %>-create-panel'
import <%= tableNameCase.pascal %>UpdatePanel from '@/pages/<%= libraryNameCase.kebab %>/<%= tableNameCase.kebab%>/components/<%= tableNameCase.kebab %>-update-panel'```

## `./templates/panel/tab-panel-item.ts.ejs`

```tsx
{
  title: t('<%= tableNameRelatedCase.snake %>', { ns: 'modules' }),
  children: (
    <DataPanel
      ref={<%= tableNameRelatedCase.camel %>Ref}
      selectable
      multiple
      layout='list'
      id={`<%= tableNameCase.kebab %>-${item?.id}`}
      url={`/<%= tableNameCase.kebab %>/${item?.id}/<%= tableNameRelatedCase.kebab %>`}
      render={(item: <%= tableNameRelatedCase.pascal %>) => (
        <div className='flex flex-row gap-2'>
          <span className='relative px-[0.3rem] py-[0.2rem] text-sm'>
            {item.<%= mainField %>}
          </span>
        </div>
      )}
      menuActions={[
        {
          icon: <IconEdit className="mr-1 w-8 cursor-pointer" />,
          label: t('edit', { ns: 'actions' }),
          tooltip: t('editTooltip', { ns: 'contact.person' }),
          handler: (items: <%= tableNameRelatedCase.pascal %>[]) => {
            if (items.length === 1) openUpdate<%= tableNameRelatedCase.pascal %>(items[0]);
          },
          show: 'once'
        },
        {
          icon: <IconTrash className="mr-1 w-8 cursor-pointer" />,
          label: t('delete', { ns: 'actions' }),
          tooltip: t('deleteTooltip', { ns: 'contact.person' }),
          variant: 'destructive',
          handler: (items: <%= tableNameRelatedCase.pascal %>[]) => {
            openDelete<%= tableNameRelatedCase.pascal %>(items);
          },
          show: 'some'
        },
        {
          icon: <IconPlus className="mr-1 w-8 cursor-pointer" />,
          label: t('create', { ns: 'actions' }),
          tooltip: t('createTooltip', { ns: 'contact.person' }),
          variant: 'default',
          handler: () => {
            openCreate<%= tableNameRelatedCase.pascal %>();
          },
          show: 'none'
        }
      ]}
    />
  ),
  buttons: [
    {
      text: t('apply', { ns: 'actions' }),
      variant: 'default',
      onClick: () => {},
    },
  ],
}```

## `./templates/panel/tab-panel-vars.ts.ejs`

```tsx
const <%-tableNameCase.camel %>Ref = useRef<any>(null)
const { mutate: <%-tableNameCase.camel %>Delete } = use<%-tableNameCase.pascal %>Delete()```

## `./templates/panel/update-panel.ts.ejs`

```tsx
import FormPanel, { FormPanelRef, <%- hasLocale ? 'getFieldsLocale,' : '' %> } from '@/components/panels/form-panel'
import { Overlay } from '@/components/custom/overlay'
import { TabPanel } from '@/components/panels/tab-panel'
import { use<%= tableNameCase.pascal %>Get, use<%= tableNameCase.pascal %>Update } from '@/features/<%= libraryName %>/<%= tableNameCase.kebab %>'
import useEffectAfterFirstUpdate from '@/hooks/use-effect-after-first-update'
import { <%= tableNameCase.pascal %> } from '@/types/models'
import { useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
<% if (fields.filter(field => field.name).length) { %>import { EnumFieldType } from '@/enums/EnumFieldType'<% } %>
<% if (extraTabs.length) { %>
  import DataPanel from '@/components/panels/data-panel'
<% } %>
<%- extraImports %>

export type <%= tableNameCase.pascal %>UpdatePanelProps = {
  <% if (hasRelations) { %> id: number <% } %>
  data: <%= tableNameCase.pascal %>
  onUpdated?: (data: <%= tableNameCase.pascal %>) => void
}

const <%= tableNameCase.pascal %>UpdatePanel = forwardRef(
  ({  <% if (hasRelations) { %> id, <% } %> data, onUpdated }: <%= tableNameCase.pascal %>UpdatePanelProps, ref) => {
    const { t } = useTranslation([
    'actions', 
    'fields', 
    'translations',
    <% relationTables.forEach((table) => { %>
      '<%= libraryName %>.<%= table %>',
    <% }) %>
  ]);
    const { data: item, isLoading } = use<%= tableNameCase.pascal %>Get(<% if (hasRelations) { %> id, <% } %>data.id as number)
    const { mutate: <%= tableNameCase.camel %>Update } = use<%= tableNameCase.pascal %>Update()
    const formRef = useRef<FormPanelRef>(null)
      
    <%- extraVars %>

    useEffectAfterFirstUpdate(() => {
      if (item && formRef.current) {
        formRef.current.setValuesFromItem(item)
      }
    }, [item])

    useImperativeHandle(ref, () => ({}))

    return (
      <TabPanel
        activeTabIndex={0}
        tabs={[
          {
            title: t('details', { ns: 'actions' }),
            children: (
              <Overlay loading={isLoading}>
                <FormPanel
                  ref={formRef}
                  fields={[
                      <% fields.forEach((field, index, array) => { %>
                      {
                          name: '<%= field.name %>',
                          label: { text: t('<%= tableNameCase.snake %>.<%= field.name %>', { ns: 'fields' }) },
                          type: <%- field.inputType %>,
                          required: true,
                          <% if (field.url) { %>url: '<%= field.url %>',<% } %>
                          <% if (field.displayName) { %>displayName: '<%= field.displayName %>',<% } %>
                          <% if (field.valueName) { %>valueName: '<%= field.valueName %>',<% } %>
                      }<%= index < array.length - 1 || hasLocale ? ',' : '' %>
                      <% }) %>
                      <%- hasLocale ? '...getFieldsLocale([{ name: "name" }], item)' : '' %>
                  ]}
                  button={{ text: t('save', { ns: 'actions' }) }}
                  onSubmit={(data) => {
                    <%= tableNameCase.camel %>Update({ 
                      <% if (hasRelations) { %>
                        <%= fkNameCase.camel %>: id,
                      <% } %>id: data.id, data })
                    if (typeof onUpdated === 'function') {
                      onUpdated(data)
                    }
                  }}
                />
              </Overlay>
            ),
          },
          <%- extraTabs %>
        ]}
      />
    )
  }
)

<%= tableNameCase.pascal %>UpdatePanel.displayName = '<%= tableNameCase.pascal %>UpdatePanel'

export default <%= tableNameCase.pascal %>UpdatePanel```

## `./templates/route/router.tsx.ejs`

```tsx
import { createBrowserRouter, RouteObject } from 'react-router-dom'
import GeneralError from './pages/errors/general-error.tsx'
import MaintenanceError from './pages/errors/maintenance-error.tsx'
import NotFoundError from './pages/errors/not-found-error.tsx'
import UnauthorisedError from './pages/errors/unauthorised-error.tsx'

const routes = [
  {
    path: '/login',
    lazy: async () => ({
      Component: (await import('./pages/auth/login.tsx')).default,
    }),
  },
  {
    path: '/forgot-password',
    lazy: async () => ({
      Component: (await import('./pages/auth/forgot-password.tsx')).default,
    }),
  },
  {
    path: '/email-sent',
    lazy: async () => ({
      Component: (await import('./pages/auth/email-sent.tsx')).default,
    }),
  },
  {
    path: '/password-recovery/:code',
    lazy: async () => ({
      Component: (await import('./pages/auth/password-recovery.tsx')).default,
    }),
  },
  {
    path: '/otp',
    lazy: async () => ({
      Component: (await import('./pages/auth/otp.tsx')).default,
    }),
  },
  {
    path: '/tests',
    lazy: async () => ({
      Component: (await import('./components/custom/color-theme.tsx')).default,
    }),
  },

  // Main route
  {
    path: '/',
    lazy: async () => {
      const AppShell = await import('./components/app/app-shell.tsx')
      return { Component: AppShell.default }
    },
    errorElement: <GeneralError />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('./pages/index.tsx')).default,
        }),
      },
      <%- routes %>
    ],
  },

  // Error route
  { path: '/500', Component: GeneralError },
  { path: '/404', Component: NotFoundError },
  { path: '/503', Component: MaintenanceError },
  { path: '/401', Component: UnauthorisedError },

  // Fallback 404 route
  { path: '*', Component: NotFoundError },
]

const router = createBrowserRouter(routes as RouteObject[])

export default router
```

## `./templates/screen/screen.ts.ejs`

```tsx
import { PageTitle } from '@/components/custom/page-title'
import DataPanel from '@/components/panels/data-panel'
import { use<%= tableNameCase.pascal %>Delete } from '@/features/<%= libraryName %>/<%= tableNameCase.kebab %>'
import { useApp } from '@/hooks/use-app'
import { isPlural } from '@/lib/utils'
import { <%= tableNameCase.pascal %> } from '@/types/models'
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import <%= tableNameCase.pascal %>CreatePanel from './components/<%= tableNameCase.kebab %>-create-panel'
import <%= tableNameCase.pascal %>UpdatePanel from './components/<%= tableNameCase.kebab %>-update-panel'

export default function Page() {
  const [selectedItems, setSelectedItems] = useState<<%= tableNameCase.pascal %>[]>([])
  const { mutate: delete<%= tableNameCase.pascal %> } = use<%= tableNameCase.pascal %>Delete()
  const { openSheet, confirm, closeSheet } = useApp()
  const { t } = useTranslation(['<%= libraryName %>.<%= tableNameCase.kebab %>', 'modules', 'actions', 'fields'])

  const openCreate = () => {
    const id = openSheet({
      title: t('create', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
      description: t('createText', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
      children: () => (
        <<%= tableNameCase.pascal %>CreatePanel onCreated={() => closeSheet(id)} />
      ),
    })

    return id
  }

  const openDelete = (items: <%= tableNameCase.pascal %>[]) => {
    return confirm({
      title: `${t('delete', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' })} ${items.length} ${isPlural(items.length) ? t('items', { ns: 'actions' }) : t('item', { ns: 'actions' })}`,
      description: t('deleteText', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
    })
      .then(() =>
        delete<%= tableNameCase.pascal %>(
          items.map((item) => item.id).filter((id) => id !== undefined)
        )
      )
      .catch(() => setSelectedItems(items))
  }

  const openUpdate = (item: <%= tableNameCase.pascal %>) => {
    const id = openSheet({
      children: () => (
        <<%= tableNameCase.pascal %>UpdatePanel data={item} onUpdated={() => closeSheet(id)} />
      ),
      title: t('edit', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
      description: t('editText', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
    })

    return id
  }

  return (
    <>
      <PageTitle title={t('<%= tableNameCase.snake %>', { ns: 'modules' })} />
      <DataPanel
        url='/<%= tableNameCase.kebab %>'
        layout='table'
        id='<%= tableNameCase.kebab %>'
        selectable
        columns={[
          { key: 'id', header: 'ID', width: 64, isLocale: false },
          <% fieldsForSearch.forEach((field) => { %>
            { key: '<%= field.name %>', 
              header: t('<%= tableNameCase.snake %>.<%= field.name %>', { ns: 'fields' }),
              isLocale: <%= field.isLocale %>,
            },
          <% }) %>
        ]}
        selected={selectedItems as <%= tableNameCase.pascal %>[]}
        multiple
        hasSearch
        sortable
        onItemDoubleClick={(item) => openUpdate(item)}
        menuActions={[
          {
            icon: <IconEdit className='mr-1 w-8 cursor-pointer' />,
            label: t('edit', { ns: 'actions' }),
            tooltip: t('editTooltip', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
            handler: (items: <%= tableNameCase.pascal %>[]) => {
              if (items.length === 1) openUpdate(items[0])
            },
            show: 'once',
          },
          {
            icon: <IconTrash className='mr-1 w-8 cursor-pointer' />,
            label: t('delete', { ns: 'actions' }),
            tooltip: t('deleteTooltip', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
            variant: 'destructive',
            handler: (items: <%= tableNameCase.pascal %>[]) => {
              openDelete(items)
            },
            show: 'some',
          },
          {
            icon: <IconPlus className='mr-1 w-8 cursor-pointer' />,
            label: t('create', { ns: 'actions' }),
            tooltip: t('createTooltip', { ns: '<%= libraryName %>.<%= tableNameCase.kebab %>' }),
            variant: 'default',
            handler: () => {
              openCreate()
            },
            show: 'none',
          },
        ]}
      />
    </>
  )
}
```

## `./templates/service/service-locale.ts.ejs`

```tsx
import { PaginationDTO, PaginationService } from '@hedhog/pagination';
import { PrismaService } from '@hedhog/prisma';
import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { DeleteDTO } from '@hedhog/core';
import { UpdateDTO } from './dto/update.dto';
import { LocaleService } from '@hedhog/locale';

@Injectable()
export class <%= tableNameCase.pascal %>Service {
  private readonly modelName = '<%= tableNameCase.value %>';
  private readonly foreignKey = '<%= fkNameLocaleCase.value %>';

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => PaginationService))
    private readonly paginationService: PaginationService,
    @Inject(forwardRef(() => LocaleService))
    private readonly localeService: LocaleService,
  ) {}
  
  async list(locale: string, paginationParams: PaginationDTO) {
    return this.localeService.listModelWithLocale(locale, this.modelName, paginationParams)
  }

  async get(<%= pkNameCase.camel %>: number) {
    return this.localeService.getModelWithLocale(this.modelName, <%= pkNameCase.camel %>);
  }

  async create(data: CreateDTO) {
    return this.localeService.createModelWithLocale(
      this.modelName,
      this.foreignKey,
      data,
    );
  }

  async update({ <%= pkNameCase.camel %>, data }: { <%= pkNameCase.camel %>: number; data: UpdateDTO }) {
    return this.localeService.updateModelWithLocale(
      this.modelName,
      this.foreignKey,
      <%= pkNameCase.camel %>,
      data,
    );
  }

  async delete({ ids }: DeleteDTO) {
    if (ids == undefined || ids == null) {
      throw new BadRequestException(
        'You must select at least one item to delete.',
      );
    }

    return this.prismaService.<%= tableNameCase.snake %>.deleteMany({
      where: {
        <%= pkNameCase.snake %>: {
          in: ids,
        },
      },
    });
  }
}```

## `./templates/service/service-related-locale.ts.ejs`

```tsx
import { DeleteDTO } from '@hedhog/core';
import { LocaleService } from '@hedhog/locale';
import { PaginationDTO, PaginationService } from '@hedhog/pagination';
import { PrismaService } from '@hedhog/prisma';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { UpdateDTO } from './dto/update.dto';

@Injectable()
export class <%= tableNameCase.pascal %>Service {
  private readonly modelName = '<%= tableNameCase.value %>';
  private readonly foreignKey = '<%= fkNameLocaleCase.value %>';

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => PaginationService))
    private readonly paginationService: PaginationService,
    @Inject(forwardRef(() => LocaleService))
    private readonly localeService: LocaleService,
  ) {}

  async list(
    locale: string,
    <%= fkNameCase.camel %>: number,
    paginationParams: PaginationDTO,
  ) {
    const where: any = {};
    if (<%= fkNameCase.camel %> !== undefined) where.<%= fkNameCase.snake %> = <%= fkNameCase.camel %>;

    return this.localeService.listModelWithLocale(
      locale,
      this.modelName,
      paginationParams,
      {
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
      },
    );
  }

  async get(<%= pkNameCase.camel %>: number) {
    return this.localeService.getModelWithLocale(
      this.modelName,
      <%= pkNameCase.camel %>,
    );
  }

  async create(<%= fkNameCase.camel %>: number, data: CreateDTO) {
    (data as any).<%= fkNameCase.snake %> = <%= fkNameCase.camel %>;

    return this.localeService.createModelWithLocale(
      this.modelName,
      this.foreignKey,
      data,
    );
  }

  async update(<%= pkNameCase.camel %>: number, <%= fkNameCase.camel %>: number, data: UpdateDTO) {
    return this.localeService.updateModelWithLocale(
      this.modelName,
      this.foreignKey,
      <%= pkNameCase.camel %>,
      data,
      {
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
      },
    );
  }

  async delete(<%= fkNameCase.camel %>: number, { ids }: DeleteDTO) {
    if (ids == undefined || ids == null) {
      throw new BadRequestException(
        'You must select at least one item to delete.',
      );
    }

    return this.prismaService.<%= tableNameCase.snake %>.deleteMany({
      where: {
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
        <%= pkNameCase.snake %>: {
          in: ids,
        },
      },
    });
  }
}
```

## `./templates/service/service-related.ts.ejs`

```tsx
import { PaginationService, PaginationDTO } from '@hedhog/pagination';
import { PrismaService } from '@hedhog/prisma';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { UpdateDTO } from './dto/update.dto';
import { DeleteDTO } from '@hedhog/core';

@Injectable()
export class <%= tableNameCase.pascal %>Service {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly paginationService: PaginationService,
  ) {}

  async create(<%= fkNameCase.camel %>: number, data: CreateDTO) {
    return this.prismaService.<%= tableNameCase.snake %>.create({
      data: {
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
        ...data,
      },
    });
  }

  async get(<%= fkNameCase.camel %>: number, <%= pkNameCase.camel %>: number) {
    return this.prismaService.<%= tableNameCase.snake %>.findFirst({
      where: {
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
        <%= pkNameCase.camel %>:<%= pkNameCase.camel %>,
      },
    });
  }
  
  async list(paginationParams: PaginationDTO, <%= fkNameCase.camel %>?: number) {
    const where: any = {};
    if (<%= fkNameCase.camel %> !== undefined) where.<%= fkNameCase.snake %> = <%= fkNameCase.camel %>;

    return this.paginationService.paginate(
      this.prismaService.<%= tableNameCase.snake %>,
      {
        fields: '<%= fieldsForSearch.join(',') %>',
        ...paginationParams,
      },
      {
        where
      },
    );
  }

  async update(<%= fkNameCase.camel %>: number, <%= pkNameCase.camel %>: number, data: UpdateDTO) {
    return this.prismaService.<%= tableNameCase.snake %>.updateMany({
      where: { 
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
        <%= pkNameCase.snake %>: <%= pkNameCase.camel %>
      },
      data,
    });
  }

  async delete(<%= fkNameCase.camel %>: number, { ids }: DeleteDTO) {
    if (ids == undefined || ids == null) {
      throw new BadRequestException(
        'You must select at least one item to delete.',
      );
    }

    return this.prismaService.<%= tableNameCase.snake %>.deleteMany({
      where: {
        <%= fkNameCase.snake %>: <%= fkNameCase.camel %>,
        <%= pkNameCase.snake %>: {
          in: ids,
        },
      },
    });
  }
}
```

## `./templates/service/service.ts.ejs`

```tsx
import { PaginationDTO, PaginationService } from '@hedhog/pagination';
import { PrismaService } from '@hedhog/prisma';
import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { CreateDTO } from './dto/create.dto';
import { DeleteDTO } from '@hedhog/core';
import { UpdateDTO } from './dto/update.dto';

@Injectable()
export class <%= tableNameCase.pascal %>Service {

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => PaginationService))
    private readonly paginationService: PaginationService,
  ) {}
  
  async list(paginationParams: PaginationDTO) {
    const fields = <%- JSON.stringify(fieldsForSearch) %>;
    const OR: any[] = this.prismaService.createInsensitiveSearch(
      fields,
      paginationParams,
    );

    if (paginationParams.search && !isNaN(+paginationParams.search)) {
      OR.push({ <%= pkNameCase.snake %>: { equals: +paginationParams.search } });
    }

    return this.paginationService.paginate(
      this.prismaService.<%= tableNameCase.snake %>,
      paginationParams,
      {
        where: {
          OR,
        },
      },
    );
  }

  async get(<%= pkNameCase.camel %>: number) {
    return this.prismaService.<%= tableNameCase.snake %>.findUnique({
      where: { <%= pkNameCase.snake %>: <%= pkNameCase.camel %> },
    });
  }

  async create(data: CreateDTO) {
    return this.prismaService.<%= tableNameCase.snake %>.create({
      data,
    });
  }

  async update({ <%= pkNameCase.camel %>, data }: { <%= pkNameCase.camel %>: number; data: UpdateDTO }) {
    return this.prismaService.<%= tableNameCase.snake %>.update({
      where: { <%= pkNameCase.snake %>: <%- pkNameCase.camel %> },
      data,
    });
  }

  async delete({ ids }: DeleteDTO) {
    if (ids == undefined || ids == null) {
      throw new BadRequestException(
        'You must select at least one item to delete.',
      );
    }

    return this.prismaService.<%= tableNameCase.snake %>.deleteMany({
      where: {
        <%= pkNameCase.snake %>: {
          in: ids,
        },
      },
    });
  }
}```

## `./templates/translation/translation.json.ejs`

```tsx
<% const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1) %>
<% const spacing = (s) => s.replace(/[_-]/g, ' ') %>
<% const pluralize = (s) => {
    if (s.endsWith("y")) {
        return s.slice(0, -1) + "ies";
    }
    return s + "s";
}
%>{
    "create": "Create <%= capitalize(spacing(tableName)) %>",
    "createText": "Fill the <%= spacing(tableName) %> informations.",
    "createTooltip": "Create new <%= spacing(tableName) %>",
    "delete": "Delete <%= capitalize(spacing(tableName)) %>",
    "deleteText": "Are you sure to delete these <%= pluralize(spacing(tableName)) %>?",
    "deleteTooltip": "Delete the selected <%= pluralize(spacing(tableName)) %>",
    "edit": "Edit <%= capitalize(spacing(tableName)) %>",
    "editText": "View and edit <%= spacing(tableName) %> information.",
    "editTooltip": "Edit the selected <%= pluralize(spacing(tableName)) %>"
}```

## `./tools/gulp/config.ts`

```ts
// All paths are related to the base dir
export const sources = ['lib', 'actions', 'commands', 'bin'];
```

## `./tools/gulp/gulpfile.ts`

```ts
import './tasks/clean';
```

## `./tools/gulp/tasks/clean.ts`

```ts
import * as deleteEmpty from 'delete-empty';
import { series, src, task } from 'gulp';
import * as clean from 'gulp-clean';
import { sources } from '../config';

/**
 * Cleans the build output assets from the packages folders
 */
function cleanOutput() {
  const files = sources.map((source) => [
    `${source}/**/*.js`,
    `${source}/**/*.d.ts`,
    `${source}/**/*.js.map`,
    `${source}/**/*.d.ts.map`,
  ]);
  return src(
    files.reduce((a, b) => a.concat(b), []),
    {
      read: false,
    },
  ).pipe(clean());
}

/**
 * Cleans empty dirs
 */
function cleanDirs(done: () => void) {
  sources.forEach((source) => deleteEmpty.sync(`${source}/`));
  done();
}

task('clean:output', cleanOutput);
task('clean:dirs', cleanDirs);
task('clean:bundle', series('clean:output', 'clean:dirs'));
```

## `./tools/gulp/util/task-helpers.ts`

```ts
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Checks if the provided path is a directory.
 *
 * @param path - The path to check.
 * @returns { boolean } - True if the path is a directory, false otherwise.
 */
function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}

/**
 * Returns an array of all folder names in the provided directory.
 *
 * @param dir - The directory from which to retrieve the folder names.
 * @returns An array of strings representing the folder names in the directory.
 */
export function getFolders(dir: string) {
  return readdirSync(dir).filter((file) => isDirectory(join(dir, file)));
}

/**
 * Returns an array of all directories in the provided directory.
 *
 * @param base - The directory from which to retrieve the directories.
 * @returns An array of strings representing the directories in the directory.
 */
export function getDirs(base: string) {
  return getFolders(base).map((path) => `${base}/${path}`);
}
```

