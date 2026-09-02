import { createProviderAgentAPI } from '@ta-agent/base-composition';
import { SqliteRequestJournalAdapter, SqliteSessionAdapter } from '@ta-agent/base-local-adapters';
import { defineStandaloneAgentConfig } from './config.js';
import { createStandaloneCredentialResolver } from './credential-resolver.js';
import { AgentBaseStandaloneError } from './errors.js';
import { resolveStandaloneRuntimeSqliteTableNames } from './resources/sqlite-table-naming.js';
import type { CreateStandaloneAgentOptions, StandaloneAgent } from './types.js';

export function createStandaloneAgent(
  input: unknown,
  runtimeOptions: CreateStandaloneAgentOptions
): StandaloneAgent {
  const config = defineStandaloneAgentConfig(input);
  if (config.persistence.kind === 'memory' && runtimeOptions.sqlite !== undefined) {
    throw new AgentBaseStandaloneError(
      'Standalone SQLite table naming cannot be configured for Memory persistence.'
    );
  }
  const sqliteOptions =
    config.persistence.kind === 'sqlite'
      ? (() => {
          const tableNames = resolveStandaloneRuntimeSqliteTableNames(runtimeOptions.sqlite);
          return {
            session: new SqliteSessionAdapter({
              databasePath: config.persistence.databasePath,
              tableNames: tableNames.session,
            }),
            requestJournal: new SqliteRequestJournalAdapter({
              databasePath: config.persistence.databasePath,
              tableNames: tableNames.requestJournal,
            }),
          };
        })()
      : {};
  const credentialResolver =
    config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(config.credential, runtimeOptions);

  return createProviderAgentAPI({
    identity: config.identity,
    provider: {
      config: config.provider,
      ...(credentialResolver === undefined ? {} : { credentialResolver }),
    },
    ...sqliteOptions,
    ...(config.mainActor === undefined ? {} : { mainActor: config.mainActor }),
  });
}
