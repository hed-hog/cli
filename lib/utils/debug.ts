import chalk = require('chalk');

export const debug = (...args: any[]) => {
  console.info(chalk.yellow('DEBUG'), ...args);
};
