import { clone, init } from 'isomorphic-git';
import { Input } from '../commands';
import { AbstractAction } from './abstract.action';
import * as fs from 'fs';
import http from 'isomorphic-git/http/node';
import { generateRandomString } from '../lib/utils/generate-random-string';
import { join } from 'path';
import * as ora from 'ora';
import {
  AbstractPackageManager,
  PackageManagerFactory,
} from '../lib/package-managers';
import chalk = require('chalk');
import { AddAction } from './add.action';
import { BANNER, EMOJIS, MESSAGES } from '../lib/ui';
import * as inquirer from 'inquirer';
import { Runner, RunnerFactory } from '../lib/runners';
import { createServer } from 'net';
import { rm, writeFile } from 'fs/promises';
import { testDatabaseConnection } from '../lib/utils/test-database-connection';
import { runScript } from '../lib/utils/run-script';

export class NewAction extends AbstractAction {
  private debug = false;

  async showDebug(...args: any[]) {
    if (this.debug) {
      console.log(chalk.yellow('DEBUG'), ...args);
    }
  }

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

    await this.createPrismaSchema(
      backEndDirectoryPath,
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

  async createPrismaSchema(path: string, type: 'postgres' | 'mysql') {
    const spinner = ora('Creating Prisma schema').start();

    const prismaSchemaContent = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${type === 'mysql' ? 'mysql' : 'postgresql'}"
  url      = env("DATABASE_URL")
}`;

    await writeFile(
      join(path, 'src', 'prisma', 'schema.prisma'),
      prismaSchemaContent,
      'utf-8',
    );

    spinner.succeed('Prisma schema created');
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

  async configureGit(directory: string, skipGit = false) {
    const results = [];
    const spinner = ora('Configure git in project folder').start();
    results.push(
      await fs.promises.rm(`${directory}/.git`, { recursive: true }),
    );
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
