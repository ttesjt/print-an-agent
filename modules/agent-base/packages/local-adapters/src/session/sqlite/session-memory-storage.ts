import {
  decideMemoryRecord,
  memoryRecordKey,
  type SessionMemoryRecord,
  type SessionMemoryRecordKey,
  type SessionReference,
  type WriteSessionMemoryRecord,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { quoteSqliteIdentifier as quote, type SqliteSessionTableNames } from './table-names.js';

export function sessionMemoryTable(names: SqliteSessionTableNames): string {
  return `${names.sessions}_memory`;
}

export function sessionHasMemoryBindings(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM ${quote(sessionMemoryTable(names))} WHERE agent_id=? AND session_id=? AND kind='binding' LIMIT 1`
      )
      .get(ref.agentId, ref.sessionId) !== undefined
  );
}

export function sessionMemoryMigration(names: SqliteSessionTableNames): string {
  return `CREATE TABLE ${quote(sessionMemoryTable(names))} (
    agent_id TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL,
    id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
    settled INTEGER NOT NULL CHECK(settled IN (0,1)), value TEXT NOT NULL CHECK(json_valid(value)),
    PRIMARY KEY(agent_id, session_id, kind, id),
    FOREIGN KEY(agent_id,session_id) REFERENCES ${quote(names.sessions)}(agent_id,session_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX ${quote(`${names.sessions}_mem_idx`)} ON ${quote(sessionMemoryTable(names))}(agent_id,session_id,settled);`;
}

export function readSessionMemoryRecord(
  db: DatabaseSync,
  input: SessionMemoryRecordKey,
  names: SqliteSessionTableNames
): SessionMemoryRecord | undefined {
  const key = memoryRecordKey(input);
  const row = db
    .prepare(
      `SELECT revision,settled,value FROM ${quote(sessionMemoryTable(names))} WHERE agent_id=? AND session_id=? AND kind=? AND id=?`
    )
    .get(key.agentId, key.sessionId, key.kind, key.id);
  if (row === undefined) return undefined;
  if (
    typeof row.revision !== 'number' ||
    typeof row.value !== 'string' ||
    (row.settled !== 0 && row.settled !== 1)
  )
    throw new Error('Invalid Session Memory record');
  if (!Number.isSafeInteger(row.revision) || row.revision < 1)
    throw new Error('Invalid Memory record revision');
  const parsed = decideMemoryRecord(undefined, {
    ...key,
    expectedRevision: null,
    settled: row.settled === 1,
    value: row.value,
  });
  return Object.freeze({ ...parsed, revision: row.revision });
}

export function writeSessionMemoryRecord(
  db: DatabaseSync,
  input: WriteSessionMemoryRecord,
  names: SqliteSessionTableNames
): SessionMemoryRecord {
  const next = decideMemoryRecord(readSessionMemoryRecord(db, input, names), input);
  db.prepare(
    `INSERT INTO ${quote(sessionMemoryTable(names))}(agent_id,session_id,kind,id,revision,settled,value) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(agent_id,session_id,kind,id) DO UPDATE SET revision=excluded.revision,settled=excluded.settled,value=excluded.value`
  ).run(
    next.agentId,
    next.sessionId,
    next.kind,
    next.id,
    next.revision,
    next.settled ? 1 : 0,
    next.value
  );
  return next;
}

export function pendingSessionMemoryRecords(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
): readonly SessionMemoryRecord[] {
  const rows = db
    .prepare(
      `SELECT kind,id FROM ${quote(sessionMemoryTable(names))} WHERE agent_id=? AND session_id=? AND settled=0 ORDER BY kind,id LIMIT 100`
    )
    .all(ref.agentId, ref.sessionId);
  return rows.map((row) => {
    const kind = row.kind;
    if (kind !== 'binding' && kind !== 'turn' && kind !== 'mutation' && kind !== 'navigation')
      throw new Error('Invalid Session Memory record kind');
    if (typeof row.id !== 'string') throw new Error('Invalid Session Memory record ID');
    const record = readSessionMemoryRecord(db, { ...ref, kind, id: row.id }, names);
    if (record === undefined) throw new Error('Missing Memory record');
    return record;
  });
}
