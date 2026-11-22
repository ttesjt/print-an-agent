import {
  assertMemoryNotAborted,
  ContextMemoryError,
  parseStoreCommit,
  parseMemoryVersionReference,
  parseForkMemoryInput,
} from '@print-an-agent/context-memory';
import type {
  MemoryHistoryStore,
  MemoryVersionReference,
  MemoryHistoryPage,
  ListMemoryVersionsInput,
  ForkMemoryInput,
  MemorySnapshot,
  MemoryReceipt,
  StoreCommit,
} from '@print-an-agent/context-memory';
import {
  MemoryConnection,
  openMemoryConnection,
  initializeMemorySchema,
  readSnapshot,
  readReceipt,
  commitTransaction,
  forkTransaction,
  readHistoricalSnapshot,
  listHistory,
  historyChainLimit,
} from '../database/index.js';
import type { SqliteMemoryStoreOptions } from './types.js';

/** Owns connections opened by path; explicitly supplied connections are always borrowed. */
export class SqliteMemoryStore implements MemoryHistoryStore {
  readonly #connection;
  readonly #maxDeltaChain;
  constructor(options: SqliteMemoryStoreOptions) {
    try {
      this.#maxDeltaChain = historyChainLimit(options.history);
    } catch (cause) {
      throw new ContextMemoryError('CONFIG_INVALID', 'Invalid history storage options.', { cause });
    }

    this.#connection = new MemoryConnection(openMemoryConnection(options));
    this.#connection.initialize(initializeMemorySchema);
  }
  async read(memoryId: string, signal?: AbortSignal): Promise<MemorySnapshot | undefined> {
    // Admit asynchronously, then keep all SQLite work synchronous and non-interleaved.
    await Promise.resolve();
    this.#connection.assertOpen();
    assertMemoryNotAborted(signal);
    this.#identity(memoryId);
    return readSnapshot(this.#connection.database, memoryId);
  }
  async getReceipt(
    memoryId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined> {
    await Promise.resolve();
    this.#connection.assertOpen();
    assertMemoryNotAborted(signal);
    this.#identity(memoryId);
    this.#identity(requestId);
    return readReceipt(this.#connection.database, memoryId, requestId);
  }
  async commit(value: StoreCommit, signal?: AbortSignal): Promise<MemoryReceipt> {
    await Promise.resolve();
    this.#connection.assertOpen();
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
      return commitTransaction(this.#connection.database, change, signal, this.#maxDeltaChain);
    } catch (error) {
      this.#connection.retainCleanupFailure(error);
      throw error;
    }
  }
  async readVersion(
    value: MemoryVersionReference,
    signal?: AbortSignal
  ): Promise<MemorySnapshot | undefined> {
    await Promise.resolve();
    this.#connection.assertOpen();
    assertMemoryNotAborted(signal);
    return readHistoricalSnapshot(
      this.#connection.database,
      parseMemoryVersionReference(value),
      signal
    );
  }
  async listVersions(
    value: ListMemoryVersionsInput,
    signal?: AbortSignal
  ): Promise<MemoryHistoryPage> {
    await Promise.resolve();
    this.#connection.assertOpen();
    assertMemoryNotAborted(signal);
    return listHistory(this.#connection.database, value);
  }
  async fork(value: ForkMemoryInput, signal?: AbortSignal): Promise<MemoryReceipt> {
    await Promise.resolve();
    this.#connection.assertOpen();
    assertMemoryNotAborted(signal);
    const input = parseForkMemoryInput(value);
    try {
      return forkTransaction(this.#connection.database, input, signal, this.#maxDeltaChain);
    } catch (cause) {
      this.#connection.retainCleanupFailure(cause);
      throw cause;
    }
  }
  close(): void {
    this.#connection.close();
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
