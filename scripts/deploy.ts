import { execSync } from 'child_process';

/**
 * Runs the given command and throws an error if it fails.
 *
 * @param command The command to run.
 * @returns The result of running the command.
 */
function runCommand(command: string) {
  try {
    return execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    process.exit(1);
  }
}

/**
 * Deploy the CLI to the production branch.
 *
 * This command verifies that there are no uncommitted changes in the
 * repository, and then performs the following steps:
 *
 * 1. Pulls the latest changes from the "master" branch of the remote
 *    repository.
 * 2. Pushes the latest changes to the "master" branch of the remote
 *    repository.
 * 3. Creates a new version of the CLI using "npm version patch", which
 *    increments the patch version and creates a new version tag.
 * 4. Verifies that the "production" branch exists, and creates it if it
 *    doesn't.
 * 5. Pulls the latest changes from the "master" branch of the remote
 *    repository.
 * 6. Pushes the latest changes to the "master" branch of the remote
 *    repository.
 * 7. Checks out the "production" branch.
 * 8. Merges the "master" branch into the "production" branch.
 * 9. Pushes the latest changes to the "production" branch of the remote
 *    repository.
 * 10. Checks out the "master" branch again.
 *
 * After completing these steps, the command prints a success message and
 * exits with a status code of 0.
 *
 * If any of the above steps fail, the command prints an error message and
 * exits with a non-zero status code.
 */
function main() {
  try {
    const gitStatus = execSync('git status -s').toString().trim();

    if (gitStatus) {
      console.error(
        '❌ O repositório possui arquivos não commitados. Por favor, realize o commit e tente novamente.',
      );
      process.exit(1);
    }

    const gitLog = execSync('git log origin/master..master').toString().trim();

    if (gitLog) {
      runCommand('git pull origin master');
      runCommand('git push origin master');
    }

    runCommand('npm version patch');

    const branches = execSync('git branch')
      .toString()
      .trim()
      .split('\n')
      .map((branch) => branch.replace('*', '').trim());

    if (!branches.includes('production')) {
      runCommand('git branch production');
    }

    runCommand('git pull origin master');
    runCommand('git push origin master');
    runCommand('git checkout production');
    runCommand('git merge master');
    runCommand('git push origin production');
    runCommand('git checkout master');

    console.info('✅ Deploy realizado com sucesso!');
  } catch (error) {
    console.error('An error occurred during deployment:', error);
    process.exit(1);
  }
}

main();
