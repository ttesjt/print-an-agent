import { canonicalJson, parseJsonValue, type ProfileId } from '@print-an-agent/workbench-domain';

import { SqlitePersistenceError } from '../../errors.js';
import type {
  ProfilePersistenceAdapter,
  ProfilePersistenceScope,
} from '../../ports/profile-persistence-adapter.js';
import { createSqlitePersistence, type SqlitePersistence } from './create-sqlite-persistence.js';

export type SqliteDatabasePathResolver = (
  scope: ProfilePersistenceScope
) => string | Promise<string>;

export interface SqliteProfilePersistenceAdapterOptions {
  readonly resolveDatabasePath: SqliteDatabasePathResolver;
  readonly busyTimeoutMilliseconds?: number;
}

export interface SqliteProfilePersistenceAdapter extends ProfilePersistenceAdapter {
  close(): Promise<void>;
}

interface ProfilePersistenceEntry {
  readonly scopeEvidence: string;
  readonly persistence: SqlitePersistence;
}

export function createSqliteProfilePersistenceAdapter(
  options: SqliteProfilePersistenceAdapterOptions
): SqliteProfilePersistenceAdapter {
  const entries = new Map<ProfileId, Promise<ProfilePersistenceEntry>>();
  let closed = false;

  return Object.freeze({
    forProfile: async (scope: ProfilePersistenceScope) => {
      if (closed) throw new SqlitePersistenceError('The SQLite persistence adapter is closed.');
      const scopeEvidence = canonicalJson(parseJsonValue(scope.configuration ?? null));
      let entryPromise = entries.get(scope.profileId);
      if (entryPromise === undefined) {
        entryPromise = createEntry(options, scope, scopeEvidence).catch((cause: unknown) => {
          entries.delete(scope.profileId);
          throw cause;
        });
        entries.set(scope.profileId, entryPromise);
      }
      const entry = await entryPromise;
      if (closed) {
        throw new SqlitePersistenceError('The SQLite persistence adapter is closed.');
      }
      if (entry.scopeEvidence !== scopeEvidence) {
        throw new SqlitePersistenceError(
          `Profile "${scope.profileId}" was resolved with conflicting persistence configuration.`
        );
      }
      return entry.persistence;
    },
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      const pendingEntries = [...entries.values()];
      entries.clear();
      const settled = await Promise.allSettled(pendingEntries);
      for (const result of settled) {
        if (result.status === 'fulfilled') result.value.persistence.close();
      }
    },
  });
}

async function createEntry(
  options: SqliteProfilePersistenceAdapterOptions,
  scope: ProfilePersistenceScope,
  scopeEvidence: string
): Promise<ProfilePersistenceEntry> {
  const databasePath = await options.resolveDatabasePath(scope);
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new SqlitePersistenceError('The resolved SQLite database path must not be empty.');
  }
  return {
    scopeEvidence,
    persistence: createSqlitePersistence({
      databasePath,
      profileId: scope.profileId,
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
    }),
  };
}
