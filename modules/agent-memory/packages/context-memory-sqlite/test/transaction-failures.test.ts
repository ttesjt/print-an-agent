import { describe, expect, it } from 'vitest';
import { ContextMemoryError } from '@ta-agent/context-memory';
import { borrowed, domain, fileStores, FaultDatabase } from './support/fixtures.js';

const createInput = { memoryId: 'm', requestId: 'create', items: [{ content: 'remember' }] };
const failReceipt = `CREATE TRIGGER fail_receipt BEFORE INSERT ON context_memory_receipts
  BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`;

describe('SQLite atomic commit failures', () => {
  it('rolls back a snapshot written before its receipt fails, then permits retry', async () => {
    const { database, store, mutations } = borrowed();
    database.exec(failReceipt);
    await expect(mutations.create(createInput)).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      commit: { status: 'not-committed' },
    });
    expect(await store.read('m')).toBeUndefined();
    expect(await store.getReceipt('m', 'create')).toBeUndefined();
    database.exec('DROP TRIGGER fail_receipt');
    expect(await mutations.create(createInput)).toMatchObject({ status: 'committed' });
  });

  it('rolls back both records when a deferred constraint fails at COMMIT', async () => {
    const { database, store, mutations } = borrowed();
    database.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE parents (id INTEGER PRIMARY KEY);
      CREATE TABLE children (parent INTEGER REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER deferred_failure AFTER INSERT ON context_memory_receipts
      BEGIN INSERT INTO children VALUES (1); END;`);
    await expect(mutations.create(createInput)).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      commit: { status: 'not-committed' },
    });
    expect(database.isTransaction).toBe(false);
    expect(await store.read('m')).toBeUndefined();
    expect(await store.getReceipt('m', 'create')).toBeUndefined();
  });

  it('checks cancellation after both writes but before COMMIT', async () => {
    const { database, store, mutations } = borrowed();
    const controller = new AbortController();
    database.function('cancel_memory', () => {
      controller.abort();
      return 0;
    });
    database.exec(`CREATE TRIGGER cancel_write AFTER INSERT ON context_memory_receipts
      BEGIN SELECT cancel_memory(); END;`);
    await expect(mutations.create(createInput, controller.signal)).rejects.toMatchObject({
      code: 'OPERATION_ABORTED',
      commit: { status: 'not-committed' },
    });
    expect(await store.read('m')).toBeUndefined();
    expect(await store.getReceipt('m', 'create')).toBeUndefined();
  });

  it('never turns cancellation after COMMIT into an aborted operation', async () => {
    const database = new FaultDatabase(':memory:');
    const { store, mutations } = borrowed(database);
    const controller = new AbortController();
    database.afterCommit = () => controller.abort();
    const result = await mutations.create(createInput, controller.signal);
    expect(controller.signal.aborted).toBe(true);
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status === 'skipped') throw new Error('Create must not be skipped.');
    expect(await store.getReceipt('m', 'create')).toEqual(result.receipt);
  });

  it('recovers exact commit facts when the COMMIT response is lost', async () => {
    const database = new FaultDatabase(':memory:');
    const { store, mutations } = borrowed(database);
    database.failAfterCommit = true;
    const error: unknown = await mutations.create(createInput).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ContextMemoryError);
    expect(error).toMatchObject({ code: 'STORAGE_FAILED', commit: { status: 'committed' } });
    if (!(error instanceof ContextMemoryError) || error.commit?.status !== 'committed')
      throw new Error('Expected an authoritative committed receipt.');
    expect(await store.getReceipt('m', 'create')).toEqual(error.commit.receipt);
    expect(await mutations.create(createInput)).toEqual({
      status: 'committed',
      receipt: error.commit.receipt,
    });
    expect((await store.read('m'))?.revision).toBe(1);
  });

  it('retains transaction and rollback failures, poisons reuse, and fails close', async () => {
    const database = new FaultDatabase(':memory:');
    const { store, mutations } = borrowed(database);
    database.exec(failReceipt);
    database.failRollback = true;
    const error: unknown = await mutations.create(createInput).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'CLEANUP_FAILED', commit: { status: 'unknown' } });
    if (!(error instanceof ContextMemoryError) || !(error.cause instanceof AggregateError))
      throw new Error('Expected both failure causes.');
    expect(error.cause.errors).toHaveLength(2);
    expect(database.isTransaction).toBe(true);
    await expect(store.read('m')).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
      cause: error,
      commit: { status: 'not-committed' },
    });
    expect(() => store.close()).toThrow(error);
    // The borrowing host, not the poisoned adapter, owns final connection cleanup.
    database.failRollback = false;
    database.exec('ROLLBACK');
    expect(database.prepare('SELECT COUNT(*) AS n FROM context_memory_documents').get()?.n).toBe(0);
  });

  it('reports unknown on a lost connection, then recovers by receipt after reopen', async () => {
    const { path, first } = await fileStores();
    const database = new FaultDatabase(path);
    const { mutations } = borrowed(database);
    database.closeAfterCommit = true;
    database.failAfterCommit = true;
    await expect(mutations.create(createInput)).rejects.toMatchObject({
      code: 'COMMIT_STATUS_UNKNOWN',
      commit: { status: 'unknown', memoryId: 'm', requestId: 'create' },
    });
    expect(database.isOpen).toBe(false);
    const receipt = await first.getReceipt('m', 'create');
    expect(receipt).toMatchObject({ revision: 1 });
    expect(await domain(first).mutations.create(createInput)).toEqual({
      status: 'committed',
      receipt,
    });
    expect((await first.read('m'))?.revision).toBe(1);
  });

  it('does not join or roll back a transaction owned by its caller', async () => {
    const { database, mutations } = borrowed();
    database.exec('BEGIN');
    await expect(mutations.create(createInput)).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      commit: { status: 'not-committed' },
    });
    expect(database.isTransaction).toBe(true);
    database.exec('ROLLBACK');
  });
});
