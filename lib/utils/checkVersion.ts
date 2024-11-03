import chalk = require('chalk');
import { version } from '../../package.json';
import { getNpmPackage } from './get-npm-package';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

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
