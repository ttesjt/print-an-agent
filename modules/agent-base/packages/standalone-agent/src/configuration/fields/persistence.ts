import { isAbsolute } from 'node:path';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandalonePersistenceConfig } from '../types/bootstrap.js';
import { assertExactKeys, requireRecord } from '../validation.js';

const MEMORY_PERSISTENCE_KEYS = Object.freeze(['kind']);

const SQLITE_PERSISTENCE_KEYS = Object.freeze(['kind', 'databasePath']);

const MAX_DATABASE_PATH_LENGTH = 4_096;

export function parsePersistence(value: unknown): StandalonePersistenceConfig {
  const record = requireRecord(value, 'Standalone persistence');
  if (record.kind === 'memory') {
    assertExactKeys(record, MEMORY_PERSISTENCE_KEYS, 'Memory persistence');
    return Object.freeze({ kind: 'memory' });
  }
  if (record.kind === 'sqlite') {
    assertExactKeys(record, SQLITE_PERSISTENCE_KEYS, 'SQLite persistence');
    if (
      typeof record.databasePath !== 'string' ||
      record.databasePath.length === 0 ||
      record.databasePath.length > MAX_DATABASE_PATH_LENGTH ||
      record.databasePath.includes('\0') ||
      !isAbsolute(record.databasePath)
    ) {
      throw new AgentBaseStandaloneError(
        'SQLite databasePath must be a non-empty bounded absolute path.'
      );
    }
    return Object.freeze({ kind: 'sqlite', databasePath: record.databasePath });
  }
  throw new AgentBaseStandaloneError('Standalone persistence kind is invalid.');
}
