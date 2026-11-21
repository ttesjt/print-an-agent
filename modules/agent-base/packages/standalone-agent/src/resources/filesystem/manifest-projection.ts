import type {
  AgentConfigProjectionPort,
  AgentConfigProjectionView,
  ManagedAgentNamespace,
} from '@print-an-agent/base-composition';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StandaloneAgentConfig, StandaloneAgentManifest } from '../../configuration/index.js';
import { encodeStandaloneAgentManifest } from '../../configuration/index.js';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { FilesystemAgentResourceNamespace } from './types.js';

const MANIFEST_FILE_NAME = 'agent.json';

const MAX_MANIFEST_BYTES = 65_536;

const TEMPORARY_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;

function isMissingPathError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === 'ENOENT';
}

function canonicalManifest(manifest: StandaloneAgentManifest): string {
  return `${JSON.stringify(encodeStandaloneAgentManifest(manifest), null, 2)}\n`;
}

function storageError(message: string, cause?: unknown): AgentBaseStandaloneError {
  return new AgentBaseStandaloneError(message, {
    code: 'STANDALONE_AGENT_STORAGE_INVALID',
    ...(cause === undefined ? {} : { cause }),
  });
}

async function requireRegularManifest(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw storageError(
      'Managed Standalone Agent manifest must be a regular file and cannot be a symbolic link.'
    );
  }
}

async function manifestIsCurrent(
  namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>,
  manifest: StandaloneAgentManifest
): Promise<boolean> {
  try {
    const metadata = await lstat(namespace.handle.manifestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw storageError(
        'Managed Standalone Agent manifest must be a regular file and cannot be a symbolic link.'
      );
    }
    if (metadata.size > MAX_MANIFEST_BYTES) return false;
    return (await readFile(namespace.handle.manifestPath, 'utf8')) === canonicalManifest(manifest);
  } catch (cause: unknown) {
    if (isMissingPathError(cause)) return false;
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw storageError('Managed Standalone Agent manifest could not be inspected.', cause);
  }
}

export function createFilesystemStandaloneManifestProjection(
  options: Readonly<{
    createTemporaryId: () => string;
  }>
): AgentConfigProjectionPort<FilesystemAgentResourceNamespace, StandaloneAgentConfig> {
  const publish = async (
    namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>,
    view: AgentConfigProjectionView<StandaloneAgentConfig>
  ): Promise<void> => {
    const manifest: StandaloneAgentManifest = Object.freeze({
      schemaVersion: 1,
      identity: view.identity,
      config: view.config,
    });
    const temporaryId = options.createTemporaryId();
    if (!TEMPORARY_ID_PATTERN.test(temporaryId)) {
      throw storageError('Standalone temporary ID generator returned an invalid value.');
    }
    const temporaryPath = join(
      namespace.handle.directoryPath,
      `.${MANIFEST_FILE_NAME}.${temporaryId}.tmp`
    );
    try {
      try {
        await requireRegularManifest(namespace.handle.manifestPath);
      } catch (cause: unknown) {
        if (!isMissingPathError(cause)) throw cause;
      }
      await writeFile(temporaryPath, canonicalManifest(manifest), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, namespace.handle.manifestPath);
    } catch (cause: unknown) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupCause: unknown) {
        if (!isMissingPathError(cleanupCause)) {
          throw new AggregateError(
            [cause, cleanupCause],
            'Standalone manifest publication and cleanup both failed.'
          );
        }
      }
      throw cause;
    }
  };

  return Object.freeze({
    publish,
    reconcile: async (
      namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>,
      view: AgentConfigProjectionView<StandaloneAgentConfig>
    ) => {
      const manifest: StandaloneAgentManifest = Object.freeze({
        schemaVersion: 1,
        identity: view.identity,
        config: view.config,
      });
      if (await manifestIsCurrent(namespace, manifest)) {
        return Object.freeze({ kind: 'current' as const });
      }
      try {
        await publish(namespace, view);
        return Object.freeze({ kind: 'current' as const });
      } catch (cause: unknown) {
        if (
          cause instanceof AgentBaseStandaloneError &&
          cause.code === 'STANDALONE_AGENT_STORAGE_INVALID'
        ) {
          throw cause;
        }
        return Object.freeze({ kind: 'stale' as const });
      }
    },
  });
}
