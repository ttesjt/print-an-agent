export { MemoryAgentConfigAdapter } from './config/memory-agent-config-adapter.js';
export { SqliteAgentConfigAdapter } from './config/sqlite/sqlite-agent-config-adapter.js';
export type { SqliteAgentConfigAdapterOptions } from './config/sqlite/sqlite-agent-config-adapter.js';
export {
  DEFAULT_SQLITE_AGENT_CONFIG_TABLE_NAMES,
  resolveSqliteAgentConfigTableNames,
} from './config/sqlite/table-names.js';
export type {
  SqliteAgentConfigTableName,
  SqliteAgentConfigTableNames,
  SqliteAgentConfigTableNamesInput,
  SqliteAgentConfigTableNamingInput,
} from './config/sqlite/table-names.js';

export { MemoryAgentIdentityCatalogAdapter } from './identity/memory-agent-identity-catalog-adapter.js';
export type { MemoryAgentIdentityCatalogAdapterOptions } from './identity/memory-agent-identity-catalog-adapter.js';
export { SqliteAgentIdentityCatalogAdapter } from './identity/sqlite/sqlite-agent-identity-catalog-adapter.js';
export type { SqliteAgentIdentityCatalogAdapterOptions } from './identity/sqlite/sqlite-agent-identity-catalog-adapter.js';
export {
  DEFAULT_SQLITE_AGENT_IDENTITY_TABLE_NAMES,
  resolveSqliteAgentIdentityTableNames,
} from './identity/sqlite/table-names.js';
export type {
  SqliteAgentIdentityTableName,
  SqliteAgentIdentityTableNames,
  SqliteAgentIdentityTableNamesInput,
  SqliteAgentIdentityTableNamingInput,
} from './identity/sqlite/table-names.js';

export { MemoryAgentTraceAdapter } from './observability/memory-agent-trace-adapter.js';
export type {
  AgentTraceInspectionOptions,
  AgentTraceSnapshot,
  MemoryAgentTraceAdapterOptions,
} from './observability/memory-agent-trace-adapter.js';

export { MemoryOutputSink } from './request/memory-output-sink.js';
export type { MemoryOutputSnapshot } from './request/memory-output-sink.js';
export { MemoryRequestJournalAdapter } from './request/memory-request-journal-adapter.js';
export { SqliteRequestJournalAdapter } from './request/sqlite/sqlite-request-journal-adapter.js';
export type { SqliteRequestJournalAdapterOptions } from './request/sqlite/sqlite-request-journal-adapter.js';
export {
  DEFAULT_SQLITE_REQUEST_JOURNAL_TABLE_NAMES,
  resolveSqliteRequestJournalTableNames,
} from './request/sqlite/table-names.js';
export type {
  SqliteRequestJournalTableName,
  SqliteRequestJournalTableNames,
  SqliteRequestJournalTableNamesInput,
  SqliteRequestJournalTableNamingInput,
} from './request/sqlite/table-names.js';

export { MemorySessionAdapter } from './session/memory/memory-session-adapter.js';
export type { MemorySessionAdapterOptions } from './session/memory/memory-session-adapter.js';
export { SqliteSessionAdapter } from './session/sqlite/sqlite-session-adapter.js';
export type { SqliteSessionAdapterOptions } from './session/sqlite/sqlite-session-adapter.js';
export {
  DEFAULT_SQLITE_SESSION_TABLE_NAMES,
  resolveSqliteSessionTableNames,
} from './session/sqlite/table-names.js';
export type {
  SqliteSessionTableName,
  SqliteSessionTableNames,
  SqliteSessionTableNamesInput,
  SqliteSessionTableNamingInput,
} from './session/sqlite/table-names.js';
export { createMemorySessionPersistence } from './persistence/memory-session-persistence.js';
export {
  createSqliteSessionPersistence,
  type SqliteSessionPersistenceOptions,
} from './persistence/sqlite-session-persistence.js';
export type {
  CoordinatedSessionMaintenance,
  CoordinatedSessionPersistence,
  LocalLifecycleSessionPort,
} from './persistence/contracts.js';
