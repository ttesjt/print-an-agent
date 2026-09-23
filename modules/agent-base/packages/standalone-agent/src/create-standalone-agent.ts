import { createProviderAgentAPI } from '@ta-agent/base-composition';
import { createSqliteSessionPersistence } from '@ta-agent/base-local-adapters';
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
          const persistence = createSqliteSessionPersistence({
            databasePath: config.persistence.databasePath,
            session: { tableNames: tableNames.session },
            requestJournal: { tableNames: tableNames.requestJournal },
          });
          return { session: persistence.session, requestJournal: persistence.requestJournal };
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
    ...(runtimeOptions.stepOverrides === undefined
      ? {}
      : { stepOverrides: runtimeOptions.stepOverrides }),
    ...(config.mainActor === undefined ? {} : { mainActor: config.mainActor }),
  });
}
