import { join } from 'node:path';
import { checkIsGitRepository } from './check-is-git-repository';

export async function getRootPath(path = process.cwd()): Promise<string> {
  const isGitrepo = await checkIsGitRepository(path, true);

  if (isGitrepo) {
    return path;
  } else {
    const upPath = join(path, '..');

    if (upPath === path) {
      throw new Error('Root path not found.');
    }

    return getRootPath(join(path, '..'));
  }
}
