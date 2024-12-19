import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Checks if the provided path is a directory.
 *
 * @param path - The path to check.
 * @returns { boolean } - True if the path is a directory, false otherwise.
 */
function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}

/**
 * Returns an array of all folder names in the provided directory.
 *
 * @param dir - The directory from which to retrieve the folder names.
 * @returns An array of strings representing the folder names in the directory.
 */
export function getFolders(dir: string) {
  return readdirSync(dir).filter((file) => isDirectory(join(dir, file)));
}

/**
 * Returns an array of all directories in the provided directory.
 *
 * @param base - The directory from which to retrieve the directories.
 * @returns An array of strings representing the directories in the directory.
 */
export function getDirs(base: string) {
  return getFolders(base).map((path) => `${base}/${path}`);
}
