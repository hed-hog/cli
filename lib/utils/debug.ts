import chalk = require('chalk');

export const debug = (...args: any[]) => {
  console.log(chalk.yellow('DEBUG'), ...args);
};
