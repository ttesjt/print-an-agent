import {
  ManagedAgentNamespaceError,
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  type StagedManagedAgentNamespace,
} from '@print-an-agent/base-composition';
import {
  isAgentId,
  parseAgentId,
  type AgentId,
} from '@print-an-agent/base-identity-config/identity';
import { lstatSync, mkdirSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { AgentBaseStandaloneError } from '../../../errors.js';
import type { FilesystemAgentResourceNamespace } from '../types/namespace.js';
import {
  DATABASE_FILE_NAME,
  MANIFEST_FILE_NAME,
  TEMPORARY_ID_PATTERN,
  isMissingPathError,
  storageError,
} from './filesystem.js';

function normalizeRootDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)) {
    throw new AgentBaseStandaloneError('Standalone Agent root must be an absolute path.', {
      code: 'STANDALONE_ROOT_INVALID',
    });
  }
  const rootDirectory = resolve(value);
  try {
    mkdirSync(rootDirectory, { recursive: true });
    const metadata = lstatSync(rootDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new AgentBaseStandaloneError(
        'Standalone Agent root must be a directory and cannot be a symbolic link.',
        { code: 'STANDALONE_ROOT_INVALID' }
      );
    }
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Standalone Agent root could not be prepared.', {
      code: 'STANDALONE_ROOT_INVALID',
      cause,
    });
  }
  return rootDirectory;
}

function definePaths(rootDirectory: string, agentId: AgentId): FilesystemAgentResourceNamespace {
  const directoryPath = join(rootDirectory, agentId);
  return Object.freeze({
    directoryPath,
    databasePath: join(directoryPath, DATABASE_FILE_NAME),
    manifestPath: join(directoryPath, MANIFEST_FILE_NAME),
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause: unknown) {
    if (isMissingPathError(cause)) return false;
    throw cause;
  }
}

async function requirePublishedNamespace(
  paths: FilesystemAgentResourceNamespace
): Promise<boolean> {
  let directory;
  try {
    directory = await lstat(paths.directoryPath);
  } catch (cause: unknown) {
    if (isMissingPathError(cause)) return false;
    throw storageError('Managed Standalone Agent directory could not be inspected.', cause);
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw storageError(
      'Managed Standalone Agent path must be a directory and cannot be a symbolic link.'
    );
  }

  let database;
  try {
    database = await lstat(paths.databasePath);
  } catch (cause: unknown) {
    if (isMissingPathError(cause)) {
      throw storageError('Managed Standalone Agent database does not exist.');
    }
    throw storageError('Managed Standalone Agent database could not be inspected.', cause);
  }
  if (!database.isFile() || database.isSymbolicLink()) {
    throw storageError(
      'Managed Standalone Agent database must be a regular file and cannot be a symbolic link.'
    );
  }
  return true;
}

export function createFilesystemAgentResourceNamespaceAdapter(
  options: Readonly<{
    rootDirectory: string;
    createTemporaryId: () => string;
  }>
): ManagedAgentNamespacePort<FilesystemAgentResourceNamespace> {
  const rootDirectory = normalizeRootDirectory(options.rootDirectory);

  return Object.freeze({
    stage: async (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const finalPaths = definePaths(rootDirectory, agentId);
      if (await pathExists(finalPaths.directoryPath)) {
        throw new ManagedAgentNamespaceError(
          'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
          'Managed Agent namespace already exists.'
        );
      }
      const temporaryId = options.createTemporaryId();
      if (!TEMPORARY_ID_PATTERN.test(temporaryId)) {
        throw storageError('Standalone temporary ID generator returned an invalid value.');
      }
      const stagingPath = join(rootDirectory, `.${agentId}.${temporaryId}.staging`);
      try {
        await mkdir(stagingPath, { recursive: false, mode: 0o700 });
      } catch (cause: unknown) {
        throw new AgentBaseStandaloneError(
          'Standalone Agent staging directory could not be created.',
          {
            code: 'STANDALONE_AGENT_STORAGE_FAILED',
            cause,
          }
        );
      }
      return Object.freeze({
        agentId,
        phase: 'staged' as const,
        resumed: false,
        handle: Object.freeze({
          directoryPath: stagingPath,
          databasePath: join(stagingPath, DATABASE_FILE_NAME),
          manifestPath: join(stagingPath, MANIFEST_FILE_NAME),
        }),
      });
    },
    publish: async (staged: StagedManagedAgentNamespace<FilesystemAgentResourceNamespace>) => {
      const finalPaths = definePaths(rootDirectory, staged.agentId);
      if (await pathExists(finalPaths.directoryPath)) {
        throw new ManagedAgentNamespaceError(
          'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
          'Managed Agent namespace already exists.'
        );
      }
      try {
        await rename(staged.handle.directoryPath, finalPaths.directoryPath);
      } catch (cause: unknown) {
        throw new AgentBaseStandaloneError('Standalone Agent directory publication failed.', {
          code: 'STANDALONE_AGENT_STORAGE_FAILED',
          cause,
        });
      }
      return Object.freeze({
        agentId: staged.agentId,
        phase: 'published' as const,
        handle: finalPaths,
      });
    },
    abort: async (staged: StagedManagedAgentNamespace<FilesystemAgentResourceNamespace>) => {
      await rm(staged.handle.directoryPath, { recursive: true, force: true });
    },
    resolve: async (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const paths = definePaths(rootDirectory, agentId);
      if (!(await requirePublishedNamespace(paths))) return undefined;
      return Object.freeze({ agentId, phase: 'published' as const, handle: paths });
    },
    list: async () => {
      let entries;
      try {
        entries = await readdir(rootDirectory, { withFileTypes: true });
      } catch (cause: unknown) {
        throw new AgentBaseStandaloneError('Standalone Agent root could not be listed.', {
          code: 'STANDALONE_AGENT_STORAGE_FAILED',
          cause,
        });
      }
      const namespaces: ManagedAgentNamespace<FilesystemAgentResourceNamespace>[] = [];
      for (const entry of entries) {
        if (!isAgentId(entry.name)) continue;
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw storageError('A managed Agent ID path is not a regular directory.');
        }
        const agentId = parseAgentId(entry.name);
        const paths = definePaths(rootDirectory, agentId);
        if (!(await requirePublishedNamespace(paths))) continue;
        namespaces.push(Object.freeze({ agentId, phase: 'published' as const, handle: paths }));
      }
      namespaces.sort((left, right) => left.agentId.localeCompare(right.agentId));
      return Object.freeze(namespaces);
    },
  });
}
