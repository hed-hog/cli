import { Socket } from 'net';
import { AbstractAction } from './abstract.action';
import chalk = require('chalk');
import { spawn, SpawnOptions } from 'child_process';
import { join } from 'path';
import { EMOJIS } from '../lib/ui';
import { existsSync } from 'fs';

type Command = {
  command: string;
  cwd: string;
  name: string;
  options?: SpawnOptions;
};

export class StartAction extends AbstractAction {
  public async handle() {
    console.info(chalk.white(`Starting HedHog ${EMOJIS.HEDGEHOG}...`));
    this.runConcurrently([
      {
        command: 'npm run dev',
        cwd: join(process.cwd(), 'backend'),
        name: 'API',
      },
      {
        command: 'npm run dev',
        cwd: join(process.cwd(), 'admin'),
        name: 'Admin',
      },
    ]);
    await this.waitForPorts();
  }

  async runConcurrently(commands: Command[]) {
    const colors = [
      chalk.blue,
      chalk.green,
      chalk.red,
      chalk.yellow,
      chalk.magenta,
      chalk.cyan,
    ];
    commands.forEach(({ command, cwd, name, options = {} }, index) => {
      try {
        options.cwd = cwd;
        options.shell = true;
        let file = '/bin/sh';
        let args = ['-c', command];
        if (process.platform === 'win32') {
          file = 'cmd.exe';
          args = ['/s', '/c', `"${command}"`];
          options.windowsVerbatimArguments = true;
        }

        if (existsSync(options.cwd)) {
          const child_process = spawn(file, args, options);

          if (child_process.stdout) {
            child_process.stdout.on('data', (data) => {
              console.info(colors[index % colors.length](`[${name}] ${data}`));
            });
          }

          if (child_process.stderr) {
            child_process.stderr.on('data', (data) => {
              console.error(chalk.red(`[${name} ERROR] ${data}`));
            });
          }

          child_process.on('close', (code) => {
            console.info(`[${name}] exited with code ${code}`);
          });
        } else {
          console.error(
            chalk.red(
              `[${name} ERROR] Directory ${options.cwd} does not exist`,
            ),
          );
        }
      } catch (error) {
        console.error(chalk.red(`[${name} ERROR] ${error}`));
      }
    });
  }

  async waitForPorts() {
    let apiReady = false;
    let frontendReady = false;

    while (!apiReady || !frontendReady) {
      console.info('Waiting for ports to be available...');
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
    console.info(chalk.white('===================================='));
    console.info(chalk.green(`${EMOJIS.HEDGEHOG} HedHog is ready!`));
    console.info(chalk.blue('API is running on http://localhost:3000'));
    console.info(chalk.red('Admin is running on http://localhost:3100'));
    console.clear();
  }

  async checkPort(port: number, host = 'localhost') {
    return new Promise<boolean>((resolve) => {
      const socket = new Socket();
      socket.setTimeout(1000);
      socket
        .on('connect', () => {
          socket.destroy();
          resolve(true);
        })
        .on('timeout', () => {
          socket.destroy();
          resolve(false);
        })
        .on('error', () => {
          resolve(false);
        })
        .connect(port, host);
    });
  }
}
