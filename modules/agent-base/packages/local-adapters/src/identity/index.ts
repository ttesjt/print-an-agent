export { MemoryAgentIdentityCatalogAdapter } from './memory/index.js';

export type { MemoryAgentIdentityCatalogAdapterOptions } from './memory/index.js';

export {
  DEFAULT_SQLITE_AGENT_IDENTITY_TABLE_NAMES,
  SqliteAgentIdentityCatalogAdapter,
  resolveSqliteAgentIdentityTableNames,
} from './sqlite/index.js';

export type {
  SqliteAgentIdentityCatalogAdapterOptions,
  SqliteAgentIdentityTableName,
  SqliteAgentIdentityTableNames,
  SqliteAgentIdentityTableNamesInput,
  SqliteAgentIdentityTableNamingInput,
} from './sqlite/index.js';
