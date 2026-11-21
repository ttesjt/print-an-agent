import type {
  SqliteAgentConfigTableNames,
  SqliteAgentConfigTableNamesInput,
  SqliteAgentIdentityTableNames,
  SqliteAgentIdentityTableNamesInput,
  SqliteRequestJournalTableNames,
  SqliteRequestJournalTableNamesInput,
  SqliteSessionTableNames,
  SqliteSessionTableNamesInput,
} from '@print-an-agent/base-local-adapters';

export interface StandaloneRuntimeSqliteTableNamesInput {
  readonly session?: SqliteSessionTableNamesInput;
  readonly requestJournal?: SqliteRequestJournalTableNamesInput;
}

export interface StandaloneManagedSqliteTableNamesInput extends StandaloneRuntimeSqliteTableNamesInput {
  readonly identity?: SqliteAgentIdentityTableNamesInput;
  readonly config?: SqliteAgentConfigTableNamesInput;
}

export interface StandaloneRuntimeSqliteTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: StandaloneRuntimeSqliteTableNamesInput;
}

export interface StandaloneManagedSqliteTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: StandaloneManagedSqliteTableNamesInput;
}

export interface ResolvedStandaloneRuntimeSqliteTableNames {
  readonly session: SqliteSessionTableNames;
  readonly requestJournal: SqliteRequestJournalTableNames;
}

export interface ResolvedStandaloneManagedSqliteTableNames extends ResolvedStandaloneRuntimeSqliteTableNames {
  readonly identity: SqliteAgentIdentityTableNames;
  readonly config: SqliteAgentConfigTableNames;
}
