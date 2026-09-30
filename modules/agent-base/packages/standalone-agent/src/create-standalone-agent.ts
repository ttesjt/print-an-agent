import { createSqliteSessionPersistence } from '@ta-agent/base-local-adapters';
import { defineStandaloneAgentBootstrapConfig } from './config.js';
import { AgentBaseStandaloneError } from './errors.js';
import { resolveStandaloneRuntimeSqliteTableNames } from './resources/sqlite-table-naming.js';
import { assertStandaloneRuntimeTimeoutAuthority } from './runtime-policies.js';
import { materializeStandaloneAgentRuntime } from './runtime/materialize-standalone-agent.js';
import type { CreateStandaloneAgentOptions, StandaloneAgent } from './types.js';

export function createStandaloneAgent(
  input: unknown,
  runtimeOptions: CreateStandaloneAgentOptions
): StandaloneAgent {
  assertStandaloneRuntimeTimeoutAuthority(runtimeOptions);
  const config = defineStandaloneAgentBootstrapConfig(input);
  if (config.persistence.kind === 'memory' && runtimeOptions.sqlite !== undefined) {
    throw new AgentBaseStandaloneError(
      'Standalone SQLite table naming cannot be configured for Memory persistence.'
    );
  }
  const ports =
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
      : undefined;
  return materializeStandaloneAgentRuntime({
    identity: config.identity,
    config,
    ...(ports === undefined ? {} : { ports }),
    options: runtimeOptions,
  });
}
