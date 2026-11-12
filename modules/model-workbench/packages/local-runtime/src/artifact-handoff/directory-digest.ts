import { createHash, type Hash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { lstat, open, readdir, type FileHandle } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type { Sha256Digest } from '@print-an-agent/workbench-domain';
import { parseSha256Digest } from '@print-an-agent/workbench-domain';

import type { LocalArtifactDigestOptions } from './contracts.js';

const DIGEST_READ_BUFFER_BYTES = 1024 * 1024;

interface ArtifactFileEntry {
  readonly relativePath: string;
  readonly absolutePath: string;
}

export async function deriveLocalDirectoryArtifactDigest(
  directory: string,
  options?: LocalArtifactDigestOptions
): Promise<Sha256Digest> {
  assertNotAborted(options?.signal);
  const rootStats = await lstat(directory);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Local Artifact must be a real directory.');
  }
  const entries = canonicalizeEntries(await collectFiles(directory, '', options?.signal));
  if (entries.length === 0) throw new Error('Local Artifact must contain at least one file.');

  const hash = createHash('sha256');
  for (const entry of entries) {
    assertNotAborted(options?.signal);
    await hashFile(hash, entry, options?.signal);
  }
  return parseSha256Digest(`sha256:${hash.digest('hex')}`, 'localArtifact.digest');
}

async function collectFiles(
  root: string,
  relativeDirectory: string,
  signal?: AbortSignal
): Promise<readonly ArtifactFileEntry[]> {
  assertNotAborted(signal);
  const directory = join(root, relativeDirectory);
  const names = await readdir(directory);
  const files: ArtifactFileEntry[] = [];
  for (const name of names) {
    assertNotAborted(signal);
    const relativePath = relativeDirectory === '' ? name : join(relativeDirectory, name);
    const absolutePath = join(root, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Local Artifact contains symbolic link "${relativePath}".`);
    }
    if (stats.isDirectory()) {
      files.push(...(await collectFiles(root, relativePath, signal)));
    } else if (stats.isFile()) {
      files.push({ relativePath, absolutePath });
    } else {
      throw new Error(`Local Artifact contains unsupported entry "${relativePath}".`);
    }
  }
  return files;
}

function canonicalizeEntries(entries: readonly ArtifactFileEntry[]): readonly ArtifactFileEntry[] {
  const canonical = entries.map((entry) => {
    const portablePath = entry.relativePath.split(sep).join('/');
    if (portablePath.includes('\\')) {
      throw new Error(`Local Artifact path "${portablePath}" is not portable.`);
    }
    return Object.freeze({
      relativePath: portablePath.normalize('NFC'),
      absolutePath: entry.absolutePath,
    });
  });
  canonical.sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1]?.relativePath === canonical[index]?.relativePath) {
      throw new Error(
        `Local Artifact contains paths that normalize to "${canonical[index]?.relativePath ?? ''}".`
      );
    }
  }
  return Object.freeze(canonical);
}

async function hashFile(hash: Hash, entry: ArtifactFileEntry, signal?: AbortSignal): Promise<void> {
  const handle = await open(entry.absolutePath, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    const before = await requireStableFile(handle, entry.relativePath);
    hash.update(
      `file\0${String(Buffer.byteLength(entry.relativePath, 'utf8'))}\0${entry.relativePath}\0`
    );
    hash.update(`${String(before.size)}\0`);

    const buffer = Buffer.allocUnsafe(DIGEST_READ_BUFFER_BYTES);
    let observedBytes = 0n;
    while (true) {
      assertNotAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      assertNotAborted(signal);
      if (bytesRead === 0) break;
      observedBytes += BigInt(bytesRead);
      hash.update(buffer.subarray(0, bytesRead));
    }

    const after = await requireStableFile(handle, entry.relativePath);
    if (observedBytes !== before.size || fileChanged(before, after)) {
      throw new Error(`Local Artifact file "${entry.relativePath}" changed while hashing.`);
    }
  } finally {
    await handle.close();
  }
}

async function requireStableFile(handle: FileHandle, relativePath: string) {
  const stats = await handle.stat({ bigint: true });
  if (!stats.isFile()) {
    throw new Error(`Local Artifact entry "${relativePath}" must be a regular file.`);
  }
  return stats;
}

function fileChanged(
  before: Awaited<ReturnType<typeof requireStableFile>>,
  after: Awaited<ReturnType<typeof requireStableFile>>
): boolean {
  return (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Local Artifact digest calculation was aborted.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}
