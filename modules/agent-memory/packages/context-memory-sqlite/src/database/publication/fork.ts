import type { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError, parseMemoryForkRequest } from '@print-an-agent/context-memory';
import type { MemoryReceipt, ForkMemoryInput } from '@print-an-agent/context-memory';
import { readSnapshot } from '../persistence/index.js';
import { readHistoricalSnapshot } from '../history/index.js';
import { publishChange } from './publish-snapshot.js';
import { runMemoryTransaction } from './run-transaction.js';

export function forkTransaction(
  database: DatabaseSync,
  value: ForkMemoryInput,
  signal: AbortSignal | undefined,
  maxDeltaChain: number
): MemoryReceipt {
  const { input, request } = parseMemoryForkRequest(value);
  return runMemoryTransaction(
    database,
    request,
    () => {
      if (readSnapshot(database, input.memoryId) !== undefined)
        throw new ContextMemoryError('MEMORY_ALREADY_EXISTS', 'Fork target already exists.', {
          memoryId: input.memoryId,
        });
      const source = readHistoricalSnapshot(database, input.source, signal);
      if (source === undefined)
        throw new ContextMemoryError(
          'MEMORY_VERSION_NOT_FOUND',
          'Source memory version was not found.',
          { memoryId: input.source.memoryId }
        );
      return publishChange(
        database,
        {
          request,
          expectedRevision: null,
          state: { items: source.items, config: source.config, measurement: source.measurement },
          commandOutcomes: [],
        },
        maxDeltaChain
      );
    },
    signal
  );
}
