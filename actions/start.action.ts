import { AbstractAction } from './abstract.action';
import chalk = require('chalk');
import { spawn, SpawnOptions } from 'child_process';
import { join } from 'path';
import { EMOJIS } from '../lib/ui';
import { existsSync } from 'fs';
import { getRootPath } from '../lib/utils/get-root-path';
import * as net from 'net';

type Command = {
  command: string;
  cwd: string;
  name: string;
  options?: SpawnOptions;
};

export class StartAction extends AbstractAction {
  public async handle() {
    console.info(chalk.white(`Starting HedHog ${EMOJIS.HEDGEHOG}...`));
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
    console.info(`Starting ${bin} ${args.join(' ')} in ${cwd}`);
    const childProcess = spawn(bin, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    childProcess.stderr?.on('data', (data) => {
      console.error(id, data.toString());
    });

    childProcess.stdout?.on('data', (data) => {
      console.info(id, data.toString());
    });

    return childProcess;
  }

  async waitForPorts() {
    let apiReady = false;
    let frontendReady = false;

    while (!apiReady || !frontendReady) {
      console.info('Waiting for ports...');
      apiReady = await this.checkPort(3000);
      frontendReady = await this.checkPort(3100);

      if (!apiReady || !frontendReady) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    this.complete();
  }

  complete() {
    console.clear();
    console.info();
    console.info(chalk.green(`${EMOJIS.HEDGEHOG} HedHog is ready!`));
    console.info();
    console.info(chalk.blue('API is running on http://localhost:3000'));
    console.info(chalk.red('Admin is running on http://localhost:3100'));
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
        console.error('Error:', error);
        reject(error);
      }
    });
  }
}
