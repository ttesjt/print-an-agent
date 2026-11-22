import { HISTORY_RECORD_KINDS } from './format.js';
import { upgradeLegacyHistory } from './upgrade-legacy.js';
import type { DatabaseSync } from 'node:sqlite';

const HISTORY_SCHEMA_FORMAT = 1;

/** Upgrade a legacy current-only store once; never manufacture unavailable ancestor versions. */
export function initializeHistorySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS context_memory_history_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), format INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS context_memory_history (
      memory_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
      format INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('${HISTORY_RECORD_KINDS.join("', '")}')),
      previous_revision INTEGER, depth INTEGER NOT NULL CHECK (depth >= 0),
      digest TEXT NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY (memory_id, revision)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS context_memory_history_bases
      ON context_memory_history(memory_id, revision) WHERE kind = 'base';
  `);
  const existing = database
    .prepare('SELECT format FROM context_memory_history_meta WHERE singleton = 1')
    .get();
  if (existing !== undefined) {
    if (existing.format !== HISTORY_SCHEMA_FORMAT)
      throw new Error('Unsupported memory history schema.');
    return;
  }
  upgradeLegacyHistory(database);
  database
    .prepare(`INSERT INTO context_memory_history_meta VALUES (1, ${HISTORY_SCHEMA_FORMAT})`)
    .run();
}
