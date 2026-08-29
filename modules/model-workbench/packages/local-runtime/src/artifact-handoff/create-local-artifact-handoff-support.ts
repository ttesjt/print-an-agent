import { join } from 'node:path';

import type { ArtifactReference, ProfileId } from '@ta-agent/workbench-domain';
import { defineArtifactHandoffSupport } from '@ta-agent/workbench-extension';

import {
  LOCAL_ARTIFACT_PROTOCOL,
  LocalArtifactMaterializationKind,
} from '../foundation/constants.js';
import {
  LocalArtifactAccessError,
  LocalArtifactDigestMismatchError,
} from '../foundation/errors.js';
import {
  assertStableExistingDirectory,
  ensureStableDirectory,
  parseLocalRootDirectory,
  resolveContainedPath,
} from '../foundation/paths.js';
import type {
  LocalArtifactHandoffSupport,
  LocalArtifactHandoffSupportOptions,
} from './contracts.js';
import { deriveLocalDirectoryArtifactDigest } from './directory-digest.js';
import { parseLocalDirectoryArtifactReceipt } from './local-artifact-receipt.js';

export function createLocalArtifactHandoffSupport(
  options: LocalArtifactHandoffSupportOptions
): LocalArtifactHandoffSupport {
  const rootDirectory = parseLocalRootDirectory(options.rootDirectory);

  return defineArtifactHandoffSupport({
    runtimeSupportId: options.runtimeSupportId,
    metadata: { protocol: LOCAL_ARTIFACT_PROTOCOL },
    verify: async ({ profileId, artifact }, callOptions) => {
      try {
        const directory = await resolveArtifactDirectory(rootDirectory, profileId, artifact);
        const observedDigest = await deriveLocalDirectoryArtifactDigest(directory, callOptions);
        if (observedDigest !== artifact.digest) {
          throw new LocalArtifactDigestMismatchError(artifact.artifactId);
        }
      } catch (cause: unknown) {
        if (isAbortError(cause) || cause instanceof LocalArtifactDigestMismatchError) throw cause;
        throw new LocalArtifactAccessError(artifact.artifactId, 'verify', { cause });
      }
    },
    materialize: async ({ profileId, artifact }, callOptions) => {
      assertNotAborted(callOptions?.signal);
      try {
        const directory = await resolveArtifactDirectory(rootDirectory, profileId, artifact);
        assertNotAborted(callOptions?.signal);
        return {
          kind: LocalArtifactMaterializationKind.Directory,
          directory,
          access: 'read-only',
        };
      } catch (cause: unknown) {
        if (isAbortError(cause)) throw cause;
        throw new LocalArtifactAccessError(artifact.artifactId, 'materialize', { cause });
      }
    },
  });
}

async function resolveArtifactDirectory(
  rootDirectory: string,
  profileId: ProfileId,
  artifact: ArtifactReference
): Promise<string> {
  const canonicalRoot = await ensureStableDirectory(rootDirectory);
  const profileRoot = join(canonicalRoot, profileId);
  await ensureStableDirectory(profileRoot);
  const artifactRoot = join(profileRoot, 'artifacts');
  await ensureStableDirectory(artifactRoot);
  const receipt = parseLocalDirectoryArtifactReceipt(artifact.handoff.receipt);
  const directory = resolveContainedPath(artifactRoot, receipt.relativePath);
  await assertStableExistingDirectory(directory);
  return directory;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Local Artifact materialization was aborted.', { cause: signal.reason });
  error.name = 'AbortError';
  throw error;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
