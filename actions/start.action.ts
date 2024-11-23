import { AbstractAction } from './abstract.action';
import chalk = require('chalk');
import { spawn } from 'child_process';
import { join } from 'path';
import { EMOJIS } from '../lib/ui';
import { getRootPath } from '../lib/utils/get-root-path';
import * as net from 'net';
import * as ora from 'ora';

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
