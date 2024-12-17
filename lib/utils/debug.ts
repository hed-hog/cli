import chalk = require('chalk');

/**
 * Logs debug information to the console with the DEBUG label.
 * @param args The arguments to be logged as debug information.
 * @returns {void} None
 */
export const debug = (...args: any[]): void => {
  console.info(chalk.yellow('DEBUG'), ...args);
};
