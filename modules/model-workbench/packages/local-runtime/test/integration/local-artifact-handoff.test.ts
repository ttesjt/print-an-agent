import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseArtifactReference,
  parseProfileId,
  parseSha256Digest,
} from '@print-an-agent/workbench-domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalArtifactHandoffSupport,
  defineLocalDirectoryArtifactReceipt,
  deriveLocalDirectoryArtifactDigest,
  LocalArtifactDigestMismatchError,
  LocalArtifactMaterializationKind,
} from '../../src/index.js';

const directories: string[] = [];
const profileId = parseProfileId('profile-local');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('local Artifact Handoff Support', () => {
  it('verifies and materializes a deterministic Profile-scoped directory Artifact', async () => {
    const rootDirectory = await temporaryDirectory();
    const artifactDirectory = await createArtifact(rootDirectory, profileId, 'run-1/parameters', {
      'config.json': '{"kind":"tiny"}\n',
      'weights/part.bin': 'parameter-bytes',
    });
    const digest = await deriveLocalDirectoryArtifactDigest(artifactDirectory);
    const support = createLocalArtifactHandoffSupport({
      runtimeSupportId: 'local-artifacts',
      rootDirectory,
    });
    const artifact = parseArtifactReference({
      artifactId: 'artifact-local',
      digest,
      handoff: {
        runtimeSupportId: 'local-artifacts',
        receipt: defineLocalDirectoryArtifactReceipt({ relativePath: 'run-1/parameters' }),
      },
    });

    await expect(support.verify({ profileId, artifact })).resolves.toBeUndefined();
    const canonicalArtifactDirectory = await realpath(artifactDirectory);
    await expect(support.materialize({ profileId, artifact })).resolves.toEqual({
      artifactId: artifact.artifactId,
      digest,
      binding: {
        kind: LocalArtifactMaterializationKind.Directory,
        directory: canonicalArtifactDirectory,
        access: 'read-only',
      },
    });
  });

  it('rejects content whose digest no longer matches its accepted reference', async () => {
    const rootDirectory = await temporaryDirectory();
    await createArtifact(rootDirectory, profileId, 'run-2/parameters', {
      'weights.bin': 'changed-after-acceptance',
    });
    const support = createLocalArtifactHandoffSupport({
      runtimeSupportId: 'local-artifacts',
      rootDirectory,
    });
    const artifact = parseArtifactReference({
      artifactId: 'artifact-mismatch',
      digest: parseSha256Digest(`sha256:${'0'.repeat(64)}`),
      handoff: {
        runtimeSupportId: 'local-artifacts',
        receipt: defineLocalDirectoryArtifactReceipt({ relativePath: 'run-2/parameters' }),
      },
    });

    await expect(support.verify({ profileId, artifact })).rejects.toBeInstanceOf(
      LocalArtifactDigestMismatchError
    );
  });

  it('does not resolve another Profile through the same opaque receipt', async () => {
    const rootDirectory = await temporaryDirectory();
    const artifactDirectory = await createArtifact(rootDirectory, profileId, 'shared/parameters', {
      'weights.bin': 'profile-owned',
    });
    const digest = await deriveLocalDirectoryArtifactDigest(artifactDirectory);
    const support = createLocalArtifactHandoffSupport({
      runtimeSupportId: 'local-artifacts',
      rootDirectory,
    });
    const artifact = parseArtifactReference({
      artifactId: 'artifact-scoped',
      digest,
      handoff: {
        runtimeSupportId: 'local-artifacts',
        receipt: defineLocalDirectoryArtifactReceipt({ relativePath: 'shared/parameters' }),
      },
    });

    await expect(
      support.verify({ profileId: parseProfileId('profile-other'), artifact })
    ).rejects.toMatchObject({ code: 'LOCAL_ARTIFACT_ACCESS_FAILED' });
  });

  it('rejects symbolic links inside an Artifact directory', async () => {
    const rootDirectory = await temporaryDirectory();
    const artifactDirectory = await createArtifact(rootDirectory, profileId, 'run-3/parameters', {
      'weights.bin': 'real-content',
    });
    await symlink(join(artifactDirectory, 'weights.bin'), join(artifactDirectory, 'alias.bin'));

    await expect(deriveLocalDirectoryArtifactDigest(artifactDirectory)).rejects.toThrow(
      'contains symbolic link'
    );
  });

  it('uses NFC UTF-8 byte ordering and streams files larger than one digest buffer', async () => {
    const rootDirectory = await temporaryDirectory();
    const largeBytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0x61);
    const artifactDirectory = await createArtifact(rootDirectory, profileId, 'run-4/parameters', {
      'z.bin': largeBytes,
      'ä.bin': Buffer.from('unicode-name', 'utf8'),
    });
    const expected = expectedDigest([
      { relativePath: 'z.bin', bytes: largeBytes },
      { relativePath: 'ä.bin', bytes: Buffer.from('unicode-name', 'utf8') },
    ]);

    await expect(deriveLocalDirectoryArtifactDigest(artifactDirectory)).resolves.toBe(expected);
  });

  it('honors an AbortSignal before reading Artifact content', async () => {
    const rootDirectory = await temporaryDirectory();
    const artifactDirectory = await createArtifact(rootDirectory, profileId, 'run-5/parameters', {
      'weights.bin': Buffer.alloc(128 * 1024, 0x62),
    });
    const controller = new AbortController();
    controller.abort('stop');

    await expect(
      deriveLocalDirectoryArtifactDigest(artifactDirectory, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-local-artifacts-'));
  directories.push(directory);
  return directory;
}

async function createArtifact(
  rootDirectory: string,
  ownerProfileId: string,
  relativePath: string,
  files: Readonly<Record<string, string | Uint8Array>>
): Promise<string> {
  const directory = join(rootDirectory, ownerProfileId, 'artifacts', relativePath);
  await mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(files).map(async ([relativeFile, contents]) => {
      const file = join(directory, relativeFile);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, contents, 'utf8');
    })
  );
  return directory;
}

function expectedDigest(
  entries: readonly { readonly relativePath: string; readonly bytes: Uint8Array }[]
): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    const relativePath = entry.relativePath.normalize('NFC');
    hash.update(`file\0${String(Buffer.byteLength(relativePath, 'utf8'))}\0${relativePath}\0`);
    hash.update(`${String(entry.bytes.byteLength)}\0`);
    hash.update(entry.bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}
