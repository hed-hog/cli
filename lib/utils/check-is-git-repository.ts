import { existsSync } from 'fs';
import { join } from 'node:path';
import * as ora from 'ora';

export async function checkIsGitRepository(path: string, silient = false) {
  let spinner;
  if (!silient) {
    spinner = ora('Checking if is a git repository...').start();
  }
  try {
    const isGitRepository = existsSync(join(path, '.git'));
    if (!isGitRepository) {
      throw new Error('This is not a git repository.');
    }
    if (spinner) {
      spinner.succeed('This is a git repository.');
    }
    return true;
  } catch (error) {
    if (spinner) {
      spinner.fail('This is not a git repository.');
    }
    return false;
  }
}
