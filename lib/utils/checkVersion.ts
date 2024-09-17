import chalk = require('chalk');
import { version } from '../../package.json';
import { getNpmPackage } from './get-npm-package';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

const filePath = join(tmpdir(), '@hedhog/cli', 'latestVersion');

export const cehckOnlineVersion = async () => {
  try {
    const currentVersion = version;
    const {
      'dist-tags': { latest: latestVersion },
    } = await getNpmPackage('@hedhog/cli');

    if (currentVersion !== latestVersion) {
      await writeFile(filePath, latestVersion);
    }
  } catch (_error) {}
};

export const checkVersion = async () => {
  const currentVersion = version;
  if (existsSync(filePath)) {
    const latestVersion = await readFile(filePath, 'utf-8');
    if (currentVersion !== latestVersion) {
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
  cehckOnlineVersion();
};
