import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  InvalidLocalRuntimeConfigurationError,
  InvalidLocalRuntimeReceiptError,
} from './errors.js';

export function parseLocalRootDirectory(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new InvalidLocalRuntimeConfigurationError(
      'Local Runtime rootDirectory must be a non-empty path string.'
    );
  }
  if (!isAbsolute(input)) {
    throw new InvalidLocalRuntimeConfigurationError(
      'Local Runtime rootDirectory must be absolute.'
    );
  }
  return resolve(input);
}

export async function ensureStableDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('expected a real directory');
  }
  return realpath(directory);
}

export async function assertStableExistingDirectory(directory: string): Promise<void> {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('expected a real directory');
  }
  if ((await realpath(directory)) !== directory) {
    throw new Error('directory must not traverse symbolic links');
  }
}

export function resolveContainedPath(rootDirectory: string, relativePath: string): string {
  const target = resolve(rootDirectory, relativePath);
  const fromRoot = relative(rootDirectory, target);
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new InvalidLocalRuntimeReceiptError('Local Runtime receipt escapes its configured root.');
  }
  return target;
}

export function parsePortableRelativePath(input: unknown, path: string): string {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.includes('\0') ||
    input.includes('\\') ||
    input.startsWith('/')
  ) {
    throw new InvalidLocalRuntimeReceiptError(`${path} must be a portable relative path.`);
  }
  const segments = input.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new InvalidLocalRuntimeReceiptError(
      `${path} must not contain empty, current, or parent segments.`
    );
  }
  return input;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
