import { execSync } from 'child_process';

function runCommand(command: string) {
  try {
    return execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    process.exit(1);
  }
}

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

    console.log('✅ Deploy realizado com sucesso!');
  } catch (error) {
    console.error('An error occurred during deployment:', error);
    process.exit(1);
  }
}

main();
