import type { SqliteAgentIdentityTableNamingInput } from './table-names.js';

export interface SqliteAgentIdentityCatalogAdapterOptions extends SqliteAgentIdentityTableNamingInput {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}
