import chalk = require('chalk');
import { version } from '../../package.json';
import { getNpmPackage } from './get-npm-package';

export const checkVersion = async () => {
  try {
    const currentVersion = version;
    const {
      'dist-tags': { latest: latestVersion },
    } = await getNpmPackage('@hedhog/cli');

    console.log({
      currentVersion,
      latestVersion,
    });

    if (currentVersion !== latestVersion) {
      console.info(
        chalk.yellow(
          `A new version of Hedhog CLI is available! ${latestVersion} (current: ${currentVersion})`,
        ),
      );
      console.info();
      console.info(chalk.green('Run the following command to update:'));
      console.info();
      console.info(chalk.cyan('npm i -g @hedhog/cli'));
      console.info();
    }
  } catch (_error) {}
};
