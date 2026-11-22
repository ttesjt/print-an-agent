import type { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import type { OpenedMemoryConnection } from './types.js';

/** Owns only connection lifetime and fencing; the Store supplies schema composition explicitly. */
export class MemoryConnection {
  readonly database: DatabaseSync;
  readonly #owned: boolean;
  #closed = false;
  #cleanupFailure: ContextMemoryError | undefined;
  constructor(opened: OpenedMemoryConnection) {
    this.database = opened.database;
    this.#owned = opened.owned;
  }
  initialize(initializeSchema: (database: DatabaseSync) => void): void {
    try {
      if (this.database.isTransaction)
        throw new Error('Cannot initialize inside a caller-owned transaction.');
      initializeSchema(this.database);
    } catch (cause) {
      if (this.#owned) {
        try {
          this.database.close();
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
  close(): void {
    if (!this.#closed) {
      try {
        if (this.#owned) this.database.close();
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
  assertOpen(): void {
    if (this.#cleanupFailure !== undefined)
      throw new ContextMemoryError(
        'CLEANUP_FAILED',
        'Memory store has unresolved cleanup failure.',
        {
          cause: this.#cleanupFailure,
          commit: { status: 'not-committed' },
        }
      );
    if (this.#closed || !this.database.isOpen)
      throw new ContextMemoryError('STORAGE_FAILED', 'Memory store is closed.', {
        commit: { status: 'not-committed' },
      });
  }
  retainCleanupFailure(cause: unknown): void {
    if (cause instanceof ContextMemoryError && cause.code === 'CLEANUP_FAILED')
      this.#cleanupFailure = cause;
  }
}
