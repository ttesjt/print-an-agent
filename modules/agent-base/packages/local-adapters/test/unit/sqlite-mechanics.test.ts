import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { runSqliteTransaction, useSqliteConnection } from '../../src/sqlite/index.js';
import type { SqliteConnectionFailureMapping } from '../../src/sqlite/index.js';
const errors: SqliteConnectionFailureMapping = {
  operation: (cause) => (cause instanceof Error ? cause : new Error('Operation failed', { cause })),
  close: (cause) => new Error('Close failed', { cause }),
  combine: (operation, cleanup) => new AggregateError([operation, cleanup]),
};
it('configures and closes a real owned SQLite connection after synchronous work', () => {
  let owned: DatabaseSync | undefined;
  const result = useSqliteConnection(
    { databasePath: ':memory:', busyTimeoutMilliseconds: 1234 },
    (db) => {
      owned = db;
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 1234 });
      return 42;
    },
    errors
  );
  expect(result).toBe(42);
  expect(owned?.isOpen).toBe(false);
});
it('closes a failed operation and preserves its boundary error identity', () => {
  let owned: DatabaseSync | undefined;
  const failure = new Error('Expected domain failure');
  expect(() =>
    useSqliteConnection(
      { databasePath: ':memory:', busyTimeoutMilliseconds: 1234 },
      (db) => {
        owned = db;
        throw failure;
      },
      errors
    )
  ).toThrow(failure);
  expect(owned?.isOpen).toBe(false);
});
it('joins an enclosing transaction without committing it and rejects a required fresh transaction', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE records (id INTEGER); BEGIN IMMEDIATE');
    const rollbackFailure = (primary: unknown, rollback: unknown) =>
      new AggregateError([primary, rollback]);
    runSqliteTransaction(db, () => db.exec('INSERT INTO records VALUES (1)'), {
      begin: 'BEGIN IMMEDIATE',
      existing: 'join',
      rollbackFailure,
    });
    expect(db.isTransaction).toBe(true);
    expect(() =>
      runSqliteTransaction(db, () => 0, {
        begin: 'BEGIN IMMEDIATE',
        existing: 'start',
        rollbackFailure,
      })
    ).toThrow();
    expect(db.isTransaction).toBe(true);
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT * FROM records').all()).toEqual([]);
  } finally {
    db.close();
  }
});
it('rolls back failed work and preserves both failures when rollback itself fails', () => {
  const db = new DatabaseSync(':memory:');
  const failure = new Error('Work failed');
  const options = {
    begin: 'BEGIN IMMEDIATE',
    existing: 'start',
    rollbackFailure: (primary: unknown, rollback: unknown) =>
      new AggregateError([primary, rollback]),
  } as const;
  try {
    db.exec('CREATE TABLE records (id INTEGER)');
    expect(() =>
      runSqliteTransaction(
        db,
        () => {
          db.exec('INSERT INTO records VALUES (1)');
          throw failure;
        },
        options
      )
    ).toThrow(failure);
    expect(db.prepare('SELECT * FROM records').all()).toEqual([]);
    try {
      runSqliteTransaction(
        db,
        () => {
          db.exec('ROLLBACK');
          throw failure;
        },
        options
      );
      throw new Error('Expected rollback failure');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) throw error;
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toBe(failure);
    }
  } finally {
    db.close();
  }
});
