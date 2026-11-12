import { DatabaseSync } from 'node:sqlite';
import {
  assertMemoryNotAborted,
  ContextMemoryError,
  parseStoreCommit,
  type MemoryHistoryStore,
  type MemoryVersionReference,
  type MemoryHistoryPage,
  type ListMemoryVersionsInput,
  type ForkMemoryInput,
  parseMemoryVersionReference,
  parseForkMemoryInput,
  type MemorySnapshot,
  type MemoryReceipt,
  type StoreCommit,
} from '@print-an-agent/context-memory';
import { initializeMemorySchema } from './schema.js';
import { readSnapshot, readReceipt } from './records.js';
import { commitTransaction, forkTransaction } from './transaction.js';
import { readHistoricalSnapshot } from './history/records.js';
import { listHistory } from './history/pagination.js';
import { historyChainLimit, type MemoryHistoryStorageOptions } from './history/codec.js';

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;
export type SqliteMemoryStoreOptions = (
  | { readonly path: string; readonly busyTimeoutMs?: number; readonly database?: never }
  | { readonly database: DatabaseSync; readonly path?: never; readonly busyTimeoutMs?: never }
) & { readonly history?: MemoryHistoryStorageOptions };

function openMemoryDatabase(path: string, timeout: number): DatabaseSync {
  try {
    return new DatabaseSync(path, { timeout });
  } catch (cause) {
    throw new ContextMemoryError('STORAGE_FAILED', 'Memory database could not be opened.', {
      cause,
    });
  }
}

/** Owns connections opened by path; explicitly supplied connections are always borrowed. */
export class SqliteMemoryStore implements MemoryHistoryStore {
  readonly #database;
  readonly #owned;
  readonly #maxDeltaChain;
  #closed = false;
  #cleanupFailure: ContextMemoryError | undefined;
  constructor(options: SqliteMemoryStoreOptions) {
    try {
      this.#maxDeltaChain = historyChainLimit(options.history);
    } catch (cause) {
      throw new ContextMemoryError('CONFIG_INVALID', 'Invalid history storage options.', { cause });
    }
    if (options.database !== undefined) {
      this.#database = options.database;
      this.#owned = false;
    } else {
      if (typeof options.path !== 'string' || options.path.length === 0)
        throw new ContextMemoryError('CONFIG_INVALID', 'SQLite path is required.');
      const timeout = options.busyTimeoutMs ?? DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
      if (!Number.isSafeInteger(timeout) || timeout < 0)
        throw new ContextMemoryError(
          'CONFIG_INVALID',
          'SQLite busy timeout must be a nonnegative safe integer.'
        );
      this.#database = openMemoryDatabase(options.path, timeout);
      this.#owned = true;
    }
    try {
      if (this.#database.isTransaction)
        throw new Error('Cannot initialize inside a caller-owned transaction.');
      initializeMemorySchema(this.#database);
    } catch (cause) {
      if (this.#owned) {
        try {
          this.#database.close();
        } catch (cleanup) {
          throw new ContextMemoryError(
            'CLEANUP_FAILED',
            'Memory store initialization and connection cleanup failed.',
            {
              cause: new AggregateError([cause, cleanup], 'Initialization cleanup failed.', {
                cause,
              }),
            }
          );
        }
      }
      if (cause instanceof ContextMemoryError && cause.code === 'CLEANUP_FAILED') throw cause;
      throw new ContextMemoryError(
        'STORAGE_FAILED',
        'Memory store schema could not be initialized.',
        { cause }
      );
    }
  }
  async read(memoryId: string, signal?: AbortSignal): Promise<MemorySnapshot | undefined> {
    // Admit asynchronously, then keep all SQLite work synchronous and non-interleaved.
    await Promise.resolve();
    this.#assertOpen();
    assertMemoryNotAborted(signal);
    this.#identity(memoryId);
    return readSnapshot(this.#database, memoryId);
  }
  async getReceipt(
    memoryId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined> {
    await Promise.resolve();
    this.#assertOpen();
    assertMemoryNotAborted(signal);
    this.#identity(memoryId);
    this.#identity(requestId);
    return readReceipt(this.#database, memoryId, requestId);
  }
  async commit(value: StoreCommit, signal?: AbortSignal): Promise<MemoryReceipt> {
    await Promise.resolve();
    this.#assertOpen();
    assertMemoryNotAborted(signal);
    let change: StoreCommit;
    try {
      change = parseStoreCommit(value);
    } catch (cause) {
      throw new ContextMemoryError('INPUT_INVALID', 'Invalid memory store commit.', {
        cause,
        commit: { status: 'not-committed' },
      });
    }
    try {
      return commitTransaction(this.#database, change, signal, this.#maxDeltaChain);
    } catch (error) {
      if (error instanceof ContextMemoryError && error.code === 'CLEANUP_FAILED')
        this.#cleanupFailure = error;
      throw error;
    }
  }
  async readVersion(
    value: MemoryVersionReference,
    signal?: AbortSignal
  ): Promise<MemorySnapshot | undefined> {
    await Promise.resolve();
    this.#assertOpen();
    assertMemoryNotAborted(signal);
    return readHistoricalSnapshot(this.#database, parseMemoryVersionReference(value), signal);
  }
  async listVersions(
    value: ListMemoryVersionsInput,
    signal?: AbortSignal
  ): Promise<MemoryHistoryPage> {
    await Promise.resolve();
    this.#assertOpen();
    assertMemoryNotAborted(signal);
    return listHistory(this.#database, value);
  }
  async fork(value: ForkMemoryInput, signal?: AbortSignal): Promise<MemoryReceipt> {
    await Promise.resolve();
    this.#assertOpen();
    assertMemoryNotAborted(signal);
    const input = parseForkMemoryInput(value);
    try {
      return forkTransaction(this.#database, input, signal, this.#maxDeltaChain);
    } catch (cause) {
      if (cause instanceof ContextMemoryError && cause.code === 'CLEANUP_FAILED')
        this.#cleanupFailure = cause;
      throw cause;
    }
  }
  close(): void {
    if (!this.#closed) {
      try {
        if (this.#owned) this.#database.close();
      } catch (cause) {
        throw new ContextMemoryError('CLEANUP_FAILED', 'Memory connection could not be closed.', {
          cause:
            this.#cleanupFailure === undefined
              ? cause
              : new AggregateError(
                  [this.#cleanupFailure, cause],
                  'Transaction cleanup and connection close failed.',
                  { cause }
                ),
          ...(this.#cleanupFailure?.commit === undefined
            ? {}
            : { commit: this.#cleanupFailure.commit }),
        });
      }
      this.#closed = true;
    }
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure;
  }
  #assertOpen(): void {
    if (this.#cleanupFailure !== undefined)
      throw new ContextMemoryError(
        'CLEANUP_FAILED',
        'Memory store has unresolved cleanup failure.',
        {
          cause: this.#cleanupFailure,
          commit: { status: 'not-committed' },
        }
      );
    if (this.#closed || !this.#database.isOpen)
      throw new ContextMemoryError('STORAGE_FAILED', 'Memory store is closed.', {
        commit: { status: 'not-committed' },
      });
  }
  #identity(value: string): void {
    if (
      typeof value !== 'string' ||
      !value.isWellFormed() ||
      value.trim() === '' ||
      value.includes('\0')
    )
      throw new ContextMemoryError('INPUT_INVALID', 'Memory/request identity must be nonempty.');
  }
}
