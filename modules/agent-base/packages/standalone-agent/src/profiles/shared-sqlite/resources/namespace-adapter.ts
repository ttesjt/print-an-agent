import {
  ManagedAgentNamespaceError,
  type ManagedAgentNamespacePort,
  type StagedManagedAgentNamespace,
} from '@print-an-agent/base-composition';
import { parseAgentId, type AgentId } from '@print-an-agent/base-identity-config/identity';
import { DatabaseSync } from 'node:sqlite';
import { AgentBaseStandaloneError } from '../../../errors.js';
import {
  type SqliteManagedNamespaceTableNames,
  type SqliteManagedNamespaceTableNamingInput,
} from '../types/namespace-tables.js';
import type { SharedSqliteAgentResourceNamespace } from '../types/namespace.js';
import { normalizeBusyTimeout, normalizeDatabasePath, useDatabase } from './namespace/database.js';
import { storageError } from './namespace/errors.js';
import { initializeSchema } from './namespace/schema.js';
import { runTransaction } from './namespace/transaction.js';
import type { SharedSqliteConfiguration, SqliteRow } from './namespace/types.js';
import { quoteSqliteIdentifier, resolveSqliteManagedNamespaceTableNames } from './table-names.js';

type NamespaceState = 'pending' | 'published';

function readState(
  database: DatabaseSync,
  agentId: AgentId,
  tableNames: SqliteManagedNamespaceTableNames
): NamespaceState | undefined {
  const row = database
    .prepare(`SELECT state FROM ${quoteSqliteIdentifier(tableNames.namespaces)} WHERE agent_id = ?`)
    .get(agentId) as SqliteRow | undefined;
  if (row === undefined) return undefined;
  if (row.state !== 'pending' && row.state !== 'published') {
    throw storageError('Shared SQLite namespace contains an invalid publication state.');
  }
  return row.state;
}

export function createSharedSqliteAgentResourceNamespaceAdapter(
  options: Readonly<{
    databasePath: string;
    busyTimeoutMilliseconds?: number;
  }> &
    SqliteManagedNamespaceTableNamingInput
): ManagedAgentNamespacePort<SharedSqliteAgentResourceNamespace> {
  const tableNames = resolveSqliteManagedNamespaceTableNames(options);
  const configuration: SharedSqliteConfiguration = Object.freeze({
    databasePath: normalizeDatabasePath(options.databasePath),
    busyTimeoutMilliseconds: normalizeBusyTimeout(options.busyTimeoutMilliseconds),
    tableNames,
  });
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(configuration.databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    database.exec(`PRAGMA busy_timeout = ${configuration.busyTimeoutMilliseconds};`);
    initializeSchema(database, tableNames);
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Shared SQLite namespace could not be initialized.', {
      code: 'STANDALONE_AGENT_STORAGE_FAILED',
      cause,
    });
  } finally {
    if (database?.isOpen === true) database.close();
  }
  const handle = Object.freeze({ databasePath: configuration.databasePath });

  return Object.freeze({
    stage: (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const resumed = useDatabase(configuration, 'stage Agent', (connection) =>
        runTransaction(connection, () => {
          const state = readState(connection, agentId, tableNames);
          if (state === 'published') {
            throw new ManagedAgentNamespaceError(
              'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
              'Managed Agent namespace already exists.'
            );
          }
          if (state === 'pending') return true;
          connection
            .prepare(
              `INSERT INTO ${quoteSqliteIdentifier(tableNames.namespaces)} (agent_id, state) VALUES (?, ?)`
            )
            .run(agentId, 'pending');
          return false;
        })
      );
      return Promise.resolve(Object.freeze({ agentId, phase: 'staged' as const, resumed, handle }));
    },
    publish: (staged: StagedManagedAgentNamespace<SharedSqliteAgentResourceNamespace>) => {
      useDatabase(configuration, 'publish Agent', (connection) =>
        runTransaction(connection, () => {
          if (readState(connection, staged.agentId, tableNames) !== 'pending') {
            throw storageError('Shared SQLite Agent namespace is not pending publication.');
          }
          const result = connection
            .prepare(
              `UPDATE ${quoteSqliteIdentifier(tableNames.namespaces)} SET state = ? WHERE agent_id = ? AND state = ?`
            )
            .run('published', staged.agentId, 'pending');
          if (result.changes !== 1) {
            throw storageError('Shared SQLite Agent namespace publication lost ownership.');
          }
        })
      );
      return Promise.resolve(
        Object.freeze({ agentId: staged.agentId, phase: 'published' as const, handle })
      );
    },
    abort: () => Promise.resolve(),
    resolve: (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const published = useDatabase(
        configuration,
        'resolve Agent',
        (connection) => readState(connection, agentId, tableNames) === 'published'
      );
      return Promise.resolve(
        published ? Object.freeze({ agentId, phase: 'published' as const, handle }) : undefined
      );
    },
    list: () => {
      const namespaces = useDatabase(configuration, 'list Agents', (connection) => {
        const rows = connection
          .prepare(
            `SELECT agent_id FROM ${quoteSqliteIdentifier(tableNames.namespaces)} WHERE state = ? ORDER BY agent_id ASC`
          )
          .all('published') as SqliteRow[];
        return rows.map((row) => {
          if (typeof row.agent_id !== 'string') {
            throw storageError('Shared SQLite namespace Agent ID is invalid.');
          }
          return Object.freeze({
            agentId: parseAgentId(row.agent_id),
            phase: 'published' as const,
            handle,
          });
        });
      });
      return Promise.resolve(Object.freeze(namespaces));
    },
  });
}
