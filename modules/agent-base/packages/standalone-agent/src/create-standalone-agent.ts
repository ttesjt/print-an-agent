import { createProviderAgentAPI } from '@ta-agent/base-composition';
import { SqliteRequestJournalAdapter } from '@ta-agent/base-request';
import { SqliteSessionAdapter } from '@ta-agent/base-session';
import { defineStandaloneAgentConfig } from './config.js';
import { createStandaloneCredentialResolver } from './credential-resolver.js';
import type { CreateStandaloneAgentOptions, StandaloneAgent } from './types.js';

export function createStandaloneAgent(
  input: unknown,
  runtimeOptions: CreateStandaloneAgentOptions
): StandaloneAgent {
  const config = defineStandaloneAgentConfig(input);
  const sqliteOptions =
    config.persistence.kind === 'sqlite'
      ? {
          session: new SqliteSessionAdapter({
            databasePath: config.persistence.databasePath,
          }),
          requestJournal: new SqliteRequestJournalAdapter({
            databasePath: config.persistence.databasePath,
          }),
        }
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
