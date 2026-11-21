import { AgentConfigError } from '@print-an-agent/base-identity-config/config';
import { AgentIdentityError } from '@print-an-agent/base-identity-config/identity';
import {
  resolveSqliteAgentConfigTableNames,
  resolveSqliteAgentIdentityTableNames,
  resolveSqliteRequestJournalTableNames,
  resolveSqliteSessionTableNames,
} from '@print-an-agent/base-local-adapters';
import { AgentRequestError } from '@print-an-agent/base-request';
import { AgentSessionError } from '@print-an-agent/base-session';
import { AgentBaseStandaloneError } from '../errors.js';
import type {
  ResolvedStandaloneManagedSqliteTableNames,
  ResolvedStandaloneRuntimeSqliteTableNames,
  StandaloneManagedSqliteTableNamingInput,
  StandaloneRuntimeSqliteTableNamingInput,
} from './types/table-naming.js';

export function domainNamingInput<TTableNames>(
  tablePrefix: string | undefined,
  tableNames: TTableNames | undefined
): Readonly<{ tablePrefix?: string; tableNames?: TTableNames }> {
  return Object.freeze({
    ...(tablePrefix === undefined ? {} : { tablePrefix }),
    ...(tableNames === undefined ? {} : { tableNames }),
  });
}

function tableNameValues(group: object): readonly string[] {
  const values = Object.values(group as Readonly<Record<string, unknown>>);
  if (!values.every((value): value is string => typeof value === 'string')) {
    throw new TypeError('Resolved SQLite table-name groups must contain only strings.');
  }
  return values;
}

export function assertDistinctGroups(groups: readonly object[]): void {
  const tableNames = groups.flatMap(tableNameValues);
  const normalized = tableNames.map((tableName) => tableName.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new AgentBaseStandaloneError('Standalone SQLite table names must be distinct.', {
      code: 'STANDALONE_CONFIG_INVALID',
    });
  }
}

function isDomainNamingFailure(cause: unknown): boolean {
  return (
    (cause instanceof AgentIdentityError &&
      cause.code === 'AGENT_IDENTITY_CONFIGURATION_INVALID') ||
    (cause instanceof AgentConfigError && cause.code === 'CONFIG_CONFIGURATION_INVALID') ||
    (cause instanceof AgentSessionError && cause.code === 'SESSION_CONFIGURATION_INVALID') ||
    (cause instanceof AgentRequestError && cause.code === 'REQUEST_REPLAY_CONFIGURATION_INVALID')
  );
}

export function normalizeNamingFailure<T>(action: () => T): T {
  try {
    return action();
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    if (!isDomainNamingFailure(cause)) throw cause;
    throw new AgentBaseStandaloneError('Standalone SQLite table naming is invalid.', {
      code: 'STANDALONE_CONFIG_INVALID',
      cause,
    });
  }
}

export function resolveStandaloneRuntimeSqliteTableNames(
  input?: StandaloneRuntimeSqliteTableNamingInput
): ResolvedStandaloneRuntimeSqliteTableNames {
  return normalizeNamingFailure(() => {
    const tableNames = Object.freeze({
      session: resolveSqliteSessionTableNames(
        domainNamingInput(input?.tablePrefix, input?.tableNames?.session)
      ),
      requestJournal: resolveSqliteRequestJournalTableNames(
        domainNamingInput(input?.tablePrefix, input?.tableNames?.requestJournal)
      ),
    });
    assertDistinctGroups(Object.values(tableNames));
    return tableNames;
  });
}

export function resolveStandaloneManagedSqliteTableNames(
  input?: StandaloneManagedSqliteTableNamingInput
): ResolvedStandaloneManagedSqliteTableNames {
  return normalizeNamingFailure(() => {
    const runtime = resolveStandaloneRuntimeSqliteTableNames(input);
    const tableNames = Object.freeze({
      ...runtime,
      identity: resolveSqliteAgentIdentityTableNames(
        domainNamingInput(input?.tablePrefix, input?.tableNames?.identity)
      ),
      config: resolveSqliteAgentConfigTableNames(
        domainNamingInput(input?.tablePrefix, input?.tableNames?.config)
      ),
    });
    assertDistinctGroups(Object.values(tableNames));
    return tableNames;
  });
}
