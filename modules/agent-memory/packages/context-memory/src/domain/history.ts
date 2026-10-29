import type { MemorySnapshot } from '../contracts/document.js';
import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryPage,
  MemoryHistoryStore,
  MemoryVersionReference,
} from '../contracts/history.js';
import type { MemoryStore } from '../contracts/ports.js';
import type { MutationResult } from '../contracts/receipt.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { assertReceiptMatches } from '../persistence/decision.js';
import { parseMemorySnapshot } from '../validation/state.js';
import { parseMemoryReceipt } from '../validation/receipt.js';
import {
  parseMemoryVersionReference,
  parseForkMemoryInput,
  parseListMemoryVersionsInput,
} from '../validation/history.js';
import { integer, keys, record } from '../validation/value.js';
import { mutationResult, replayMutation } from './access.js';
import { parseMemoryForkRequest } from './fork-request.js';

function verifyHistoryResponse<T>(memoryId: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.code === 'HISTORY_CORRUPT') throw cause;
    throw new ContextMemoryError('HISTORY_CORRUPT', 'History adapter returned invalid data.', {
      memoryId,
      cause,
    });
  }
}

export function supportsMemoryHistory(store: MemoryStore): store is MemoryHistoryStore {
  return (
    'readVersion' in store &&
    typeof store.readVersion === 'function' &&
    'listVersions' in store &&
    typeof store.listVersions === 'function' &&
    'fork' in store &&
    typeof store.fork === 'function'
  );
}
export async function inspectMemoryVersion(
  store: MemoryHistoryStore,
  value: MemoryVersionReference,
  signal?: AbortSignal
): Promise<MemorySnapshot> {
  const input = parseMemoryVersionReference(value);
  assertMemoryNotAborted(signal);
  const valueAtRevision = await store.readVersion(input, signal);
  assertMemoryNotAborted(signal);
  if (valueAtRevision === undefined)
    throw new ContextMemoryError('MEMORY_VERSION_NOT_FOUND', 'Memory version was not found.', {
      memoryId: input.memoryId,
      details: { revision: input.revision },
    });
  const snapshot = verifyHistoryResponse(input.memoryId, () =>
    parseMemorySnapshot(valueAtRevision)
  );
  if (snapshot.memoryId !== input.memoryId || snapshot.revision !== input.revision)
    throw new ContextMemoryError('HISTORY_CORRUPT', 'History returned a different version.', {
      memoryId: input.memoryId,
    });
  return snapshot;
}
export async function listMemoryVersions(
  store: MemoryHistoryStore,
  value: ListMemoryVersionsInput,
  signal?: AbortSignal
): Promise<MemoryHistoryPage> {
  const input = parseListMemoryVersionsInput(value);
  assertMemoryNotAborted(signal);
  const page = await store.listVersions(input, signal);
  assertMemoryNotAborted(signal);
  return verifyHistoryResponse(input.memoryId, () => {
    const data = record(page, 'history page');
    keys(data, ['memoryId', 'throughRevision', 'versions', 'nextCursor']);
    const upper = integer(data.throughRevision, 'throughRevision', 1);
    if (
      page.memoryId !== input.memoryId ||
      !Array.isArray(page.versions) ||
      page.versions.length > input.limit ||
      (page.nextCursor !== undefined &&
        (typeof page.nextCursor !== 'string' ||
          page.nextCursor.length === 0 ||
          page.nextCursor.length > 4096 ||
          page.versions.length === 0))
    )
      throw new ContextMemoryError('HISTORY_CORRUPT', 'Invalid history page.', {
        memoryId: input.memoryId,
      });
    let previous = upper + 1;
    const versions = page.versions.map((entry) => {
      const reference = parseMemoryVersionReference(entry);
      if (reference.memoryId !== input.memoryId || reference.revision >= previous)
        throw new ContextMemoryError(
          'HISTORY_CORRUPT',
          'History page scope or ordering is invalid.'
        );
      previous = reference.revision;
      return reference;
    });
    return {
      memoryId: input.memoryId,
      throughRevision: upper,
      versions,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  });
}
export async function forkMemory(
  store: MemoryHistoryStore,
  value: ForkMemoryInput,
  signal?: AbortSignal
): Promise<MutationResult> {
  const input = parseForkMemoryInput(value);
  const { request } = parseMemoryForkRequest(input);
  const replay = await replayMutation(store, request, signal);
  if (replay !== undefined) return mutationResult(replay);
  assertMemoryNotAborted(signal);
  try {
    const receipt = parseMemoryReceipt(await store.fork(input, signal));
    assertReceiptMatches(receipt, request);
    return mutationResult(receipt);
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
    throw new ContextMemoryError(
      'COMMIT_STATUS_UNKNOWN',
      'Fork result is unknown; recover the original request receipt.',
      {
        memoryId: input.memoryId,
        cause,
        commit: { status: 'unknown', memoryId: input.memoryId, requestId: input.requestId },
      }
    );
  }
}
