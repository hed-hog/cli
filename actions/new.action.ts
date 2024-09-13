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
import { MESSAGES } from '../lib/ui';
import * as inquirer from 'inquirer';
import { Runner, RunnerFactory } from '../lib/runners';

export class NewAction extends AbstractAction {
  public async handle(inputs: Input[], options: Input[]) {
    const name = String(
      inputs.find(({ name }) => name === 'name')?.value || 'hedhog',
    );
    const directory = options.find(({ name }) => name === 'directory');
    const directoryPath = `${String(directory?.value) || '.'}/${name}`;
    let database = options.find(({ name }) => name === 'database')?.value;
    let dbhost = options.find(({ name }) => name === 'dbhost')?.value;
    let dbport = options.find(({ name }) => name === 'dbport')?.value;
    let dbuser = options.find(({ name }) => name === 'dbuser')?.value;
    let dbpassword = options.find(({ name }) => name === 'dbpassword')?.value;
    let dbname = options.find(({ name }) => name === 'dbname')?.value;

    if (!database) {
      const answer = await inquirer.createPromptModule({
        output: process.stderr,
        input: process.stdin,
      })({
        type: 'list',
        name: 'database',
        message: 'Select database type to use in project',
        choices: ['postgres', 'mysql'],
      });

      database = answer.database;
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
        default: database === 'postgres' ? 'postgres' : 'root',
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
        default: database === 'postgres' ? 'postgres' : 'root',
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
        default: 'hedhog',
      });

      dbname = answer.dbname;
    }

    const databaseConnection = await this.testDatabaConnection(
      database as 'postgres' | 'mysql',
      dbhost as string,
      Number(dbport),
      dbuser as string,
      dbpassword as string,
      dbname as string,
    );

    const migrationTableExists = await this.migrationtableExists(
      database as 'postgres' | 'mysql',
      dbhost as string,
      Number(dbport),
      dbuser as string,
      dbpassword as string,
      dbname as string,
    );

    if (migrationTableExists) {
      console.warn(chalk.yellow('Migration table already exists'));
    }

    await this.cloneRepository(
      'https://github.com/hed-hog/bootstrap.git',
      directoryPath,
    );

    await this.configureGit(directoryPath);

    await this.createEnvFile(directoryPath, {
      type: database as 'postgres' | 'mysql',
      host: dbhost as string,
      port: Number(dbport),
      user: dbuser as string,
      password: dbpassword as string,
      database: dbname as string,
    });

    await this.updatePrismaProvider(
      database as 'postgres' | 'mysql',
      directoryPath,
    );

    await this.updateDatabaseProviderTypeORM(
      database as 'postgres' | 'mysql',
      directoryPath,
    );

    const packageManager = await this.installPackages(options, directoryPath);

    process.chdir(name);

    switch (database) {
      case 'postgres':
        await this.installPostgres(options);
        break;
      case 'mysql':
        await this.installMySql(options);
        break;
      
    }

    process.chdir('..');

    if (databaseConnection) {
      await this.runScript('migrate:up', join(process.cwd(), name));
    }

    this.complete(name, packageManager ?? 'npm');
  }

  complete(directory: string, packageManager: string) {
    console.info();
    console.info(MESSAGES.PACKAGE_MANAGER_INSTALLATION_SUCCEED(directory));
    console.info(MESSAGES.CONFIG_DATABASE);
    console.info(MESSAGES.GET_STARTED_INFORMATION);
    console.info();
    console.info(chalk.gray(MESSAGES.CHANGE_DIR_COMMAND(directory)));
    console.info(chalk.gray(MESSAGES.START_COMMAND(packageManager)));
    console.info();
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
          query = `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        );`;
          const res = await client.query(query, ['migrations']);
          await client.end();
          return res.rowCount === 1;
        case 'mysql':
          const mysql = await import('mysql2/promise');
          const connection = await mysql.createConnection({
            host,
            user,
            password,
            database,
          });
          query = `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`;
          const result = await connection.query(query, [
            database,
            'migrations',
          ]);
          await connection.end();
          return (result as any)[0][0].count === 1;
      }
    } catch (error) {
      console.error(chalk.red(error.message));
      return false;
    }
  }

  async testDatabaConnection(
    type: 'postgres' | 'mysql',
    host: string,
    port: number,
    user: string,
    password: string,
    database: string,
  ) {
    const spinner = ora('Testing database connection').start();
    let result: any;
    try {
      if (type === 'postgres') {
        const { Client } = await import('pg');
        const client = new Client({
          user,
          host,
          database,
          password,
          port,
        });
        await client.connect();
        result = await client.query('SELECT NOW()');
        await client.end();
      } else if (type === 'mysql') {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host,
          user,
          password,
          database,
        });
        result = await connection.query('SELECT NOW()');
        await connection.end();
      }
      spinner.succeed();
    } catch (error) {
      spinner.fail('Database connection failed: ' + error.message);
      return false;
    }
    spinner.succeed('Database connection successful');
    return true;
  }

  async add(module: string) {
    const action = new AddAction();
    return action.handle(
      [{ name: 'module', value: module }],
      [{ name: 'silentComplete', value: true }],
    );
  }

  async runScript(scriptName: string, name: string) {
    let packageManager: AbstractPackageManager;

    try {
      packageManager = await PackageManagerFactory.find();
      return packageManager.runScript(scriptName, name);
    } catch (error) {
      if (error && error.message) {
        console.error(chalk.red(error.message));
      }
    }
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

  async configureGit(directory: string) {
    const results = [];
    const spinner = ora('Configure git in project folder').start();
    results.push(
      await fs.promises.rm(`${directory}/.git`, { recursive: true }),
    );
    results.push(await init({ dir: directory, fs }));
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
