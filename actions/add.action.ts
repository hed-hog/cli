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
import { testDatabaseConnection } from '../lib/utils/test-database-connection';
import { runScript } from '../lib/utils/run-script';
import { getRootPath } from '../lib/utils/get-root-path';
import { render } from 'ejs';
import { formatTypeScriptCode } from '../lib/utils/format-typescript-code';
import { getNpmPackage } from '../lib/utils/get-npm-package';
import * as YAML from 'yaml';
import { getPostgresClient } from '../lib/utils/get-pg-client';
import { getMySQLClient } from '../lib/utils/get-mysql-client';
import { Database, DatabaseFactory } from '../lib/databases';

type Menu = {
  url: string;
  icon: string;
  name: Locale;
  slug: string;
  order: string;
  menus: Menu[];
  menu_id?: number | null | Partial<Menu>;
};

type Locale = {
  [key: string]: string;
};

export class AddAction extends AbstractAction {
  private packagesAdded: string[] = [];
  private showWarning = false;
  private debug = false;
  private db: any = null;

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
    const directoryPath = await getRootPath();
    const envVars = await this.parseEnvFile(
      join(directoryPath, 'backend', '.env'),
    );
    const type = envVars.DATABASE_URL.split(':')[0] as 'postgres' | 'mysql';

    this.db = DatabaseFactory.create(
      type === 'mysql' ? Database.MYSQL : Database.POSTGRES,
      envVars.DB_HOST,
      envVars.DB_USERNAME,
      envVars.DB_PASSWORD,
      envVars.DB_DATABASE,
      Number(envVars.DB_PORT),
    );

    const isDbConnected = this.db.testDatabaseConnection();

    this.packagesAdded = packagesAdded;

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

    this.showDebug('Directory path:', directoryPath);
    this.showDebug('App module path:', appModulePath);
    this.showDebug('Add module name:', addModuleName);

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

    if (isDbConnected) {
      try {
        // await runScript('migrate:up', join(directoryPath, 'backend'));
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

        if (hedhogFile?.data) {
          for (const data of Object.keys(hedhogFile?.data)) {
            switch (data) {
              case 'menus':
                await this.applyHedhogFileDataMenus(hedhogFile?.data[data]);
                break;

              case 'routes':
                await this.applyHedhogFileDataRoutes(hedhogFile?.data[data]);
                break;

              case 'screens':
                await this.applyHedhogFileDataScreens(hedhogFile?.data[data]);
                break;

              default:
                console.warn(chalk.yellow(`Data type "${data}" not found.`));
            }
          }
        }
      } catch (error) {
        spinner.fail(error.message);
      }
    } else {
      spinner.info('Hedhog file not found.');
    }
  }

  async checkDbConnection() {
    const directoryPath = await getRootPath();
    const envVars = await this.parseEnvFile(
      join(directoryPath, 'backend', '.env'),
    );

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
      return isDbConnected;
    } else {
      return false;
    }
  }

  parseQueryValue(value: any) {
    switch (typeof value) {
      case 'number':
      case 'boolean':
        return value;

      default:
        return `'${value}'`;
    }
  }

  objectToWhereClause(obj: any) {
    let whereClause = '';

    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        whereClause += `${key} ${obj[key].operator} ${this.parseQueryValue(obj[key].value)}`;
      } else {
        whereClause += `${key} = ${this.parseQueryValue(obj[key])}`;
      }
    }

    return whereClause;
  }

  async insertMenu(parentId: number | null, menu: Menu) {
    const rows = await this.db.query(
      'INSERT INTO menus (url, icon, menu_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [menu.url, menu.icon, parentId],
      {
        returning: 'id',
      },
    );
    const menuId = rows[0].id;

    for (const localeCode in menu.name) {
      const rows = await this.db.query(
        'SELECT id FROM locales WHERE code = ?',
        [localeCode],
      );
      if (rows.length > 0) {
        const localeId = rows[0].id;
        await this.db.query(
          'INSERT INTO menu_translations (menu_id, locale_id, name) VALUES (?, ?, ?)',
          [menuId, localeId, menu.name[localeCode]],
        );
      } else {
        console.error(`Locale with code "${localeCode}" not found.`);
      }
    }

    if (menu.menus && menu.menus.length > 0) {
      for (const m of menu.menus) {
        await this.insertMenu(menuId, m);
      }
    }
  }

  async applyHedhogFileDataMenus(menus: any[]) {
    this.showDebug('insertAndApplyMenuData', { menus });
    this.showDebug('Database connection successful. Inserting menu data.');

    try {
      for (const menu of menus) {
        const { menu_id } = menu;

        let parentId: number | null = null;

        if (menu_id && typeof menu_id === 'object') {
          const rows = await this.db.query(
            `SELECT id FROM menus WHERE ${this.objectToWhereClause(menu_id)}`,
          );

          if (rows.length > 0) {
            parentId = rows[0].id;
          } else {
            console.error(`Menu with URL "${menu_id.url}" not found.`);
            continue;
          }
        }

        await this.insertMenu(parentId, menu);
      }

      this.showDebug('Menus inserted successfully.');
    } catch (error) {
      console.error('Error inserting menu data:', error);
      throw error;
    }
  }

  async applyHedhogFileDataRoutes(routes: any[]) {
    this.showDebug('applyHedhogFileDataRoutes', { routes });
    const isDbConnected = await this.checkDbConnection();

    if (isDbConnected) {
      this.showDebug('Database connection successful. Inserting route data.');
      const directoryPath = await getRootPath();
      const envVars = await this.parseEnvFile(
        join(directoryPath, 'backend', '.env'),
      );
      const type = envVars.DATABASE_URL.split(':')[0] as 'postgres' | 'mysql';

      try {
        if (type === 'postgres') {
          const client = await getPostgresClient(envVars);

          for (const route of routes) {
            const { url, method } = route;

            await client.query(
              'INSERT INTO routes (url, method, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
              [url, method],
            );
          }

          await client.end();
        } else if (type === 'mysql') {
          const connection = await getMySQLClient(envVars);
          for (const route of routes) {
            const { url, method } = route;

            await connection.query(
              'INSERT INTO routes (url, method, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
              [url, method],
            );
          }

          await connection.end();
        }
        this.showDebug('Routes inserted successfully.');
      } catch (error) {
        console.error('Error inserting route data:', error);
      }
    } else {
      console.error(
        chalk.red('Database connection failed. Could not insert route data.'),
      );
    }
  }

  async applyHedhogFileDataScreens(screens: any[]) {
    this.showDebug('applyHedhogFileDataScreens', { screens });
    const isDbConnected = await this.checkDbConnection();

    if (isDbConnected) {
      this.showDebug('Database connection successful. Inserting screen data.');
      const directoryPath = await getRootPath();
      const envVars = await this.parseEnvFile(
        join(directoryPath, 'backend', '.env'),
      );
      const type = envVars.DATABASE_URL.split(':')[0] as 'postgres' | 'mysql';

      try {
        if (type === 'postgres') {
          const client = await getPostgresClient(envVars);

          for (const screen of screens) {
            const { slug, icon, name, description } = screen;

            const result = await client.query(
              'INSERT INTO screens (slug, icon, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
              [slug, icon],
            );
            const screenId = result.rows[0].id;

            for (const localeCode in name) {
              const localeResult = await client.query(
                'SELECT id FROM locales WHERE code = $1',
                [localeCode],
              );
              const localeId = localeResult.rows[0].id;

              await client.query(
                'INSERT INTO screen_translations (screen_id, locale_id, name, description) VALUES ($1, $2, $3, $4)',
                [screenId, localeId, name[localeCode], description[localeCode]],
              );
            }
          }

          await client.end();
        } else if (type === 'mysql') {
          const connection = await getMySQLClient(envVars);
          for (const screen of screens) {
            const { slug, icon, name, description } = screen;

            const [insertScreenResult] = await connection.query(
              'INSERT INTO screens (slug, icon, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
              [slug, icon],
            );
            const insertHeader = insertScreenResult as any;
            const screenId = insertHeader.insertId;

            for (const localeCode in name) {
              const [localeResult] = await connection.query(
                'SELECT id FROM locales WHERE code = ?',
                [localeCode],
              );

              const localeId = (localeResult as any[])[0].id;
              await connection.query(
                'INSERT INTO screen_translations (screen_id, locale_id, name, description) VALUES (?, ?, ?, ?)',
                [screenId, localeId, name[localeCode], description[localeCode]],
              );
            }
          }

          await connection.end();
        }
        this.showDebug('Screens inserted successfully.');
      } catch (error) {
        console.error('Error inserting screen data:', error);
      }
    } else {
      console.error(
        chalk.red('Database connection failed. Could not insert screen data.'),
      );
    }
  }

  async updateLibsPrisma(directoryPath: string) {
    console.info();
    console.log('updateLibsPrisma', directoryPath);
    const spinner = ora('Starting updating prisma in libraries...').start();
    const libPath = join(directoryPath, 'lib');
    const libsPath = join(directoryPath, 'lib', 'libs');

    try {
      if (existsSync(libPath) && existsSync(libsPath)) {
        spinner.info('Checking database connection...');

        const {
          DB_HOST,
          DB_PORT,
          DB_USERNAME,
          DB_PASSWORD,
          DB_DATABASE,
          DATABASE_URL,
        } = await this.parseEnvFile(join(libPath, '.env'));

        spinner.info(`Database connection found...`);

        let type = DATABASE_URL.split(':')[0] as any;

        if (type === 'postgresql') {
          type = 'postgres';
        }

        const isConnected = await testDatabaseConnection(
          type,
          DB_HOST,
          Number(DB_PORT),
          DB_USERNAME,
          DB_PASSWORD,
          DB_DATABASE,
        );

        spinner.info(
          `Database connection status: ${isConnected ? 'OK' : 'FAIL'}`,
        );

        if (isConnected) {
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
      const migrationDestPath = join(
        directoryPath,
        `backend`,
        `src`,
        `typeorm`,
        `migrations`,
      );

      this.showDebug('Migrations path:', migrationsPath);
      this.showDebug('Migration dest path:', migrationDestPath);
      this.showDebug(
        'Migration dest path exists:',
        existsSync(migrationDestPath),
      );

      if (!existsSync(migrationDestPath)) {
        await this.createDirectoryRecursive(migrationDestPath);
      }

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

  async parseEnvFile(envPath: string) {
    if (existsSync(envPath)) {
      const envFile = await readFile(envPath, 'utf-8');
      const envLines = envFile.split('\n');

      const env: any = {};

      for (const line of envLines) {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key] = value.replaceAll(/['"]+/g, '');
        }
      }

      return env;
    } else {
      console.error(chalk.red(`${EMOJIS.ERROR} File .env not found.`));
    }
  }
}
