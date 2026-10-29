import {
  assertMemoryNotAborted,
  assertReceiptMatches,
  ContextMemoryError,
  decideMemoryCommit,
  parseMemoryForkRequest,
  parseListMemoryVersionsInput,
  jsonObject,
  type ForkMemoryInput,
  type MemoryHistoryStore,
  type MemorySnapshot,
  type MemoryReceipt,
  type MemoryVersionReference,
  type ListMemoryVersionsInput,
  type StoreCommit,
} from '@ta-agent/context-memory';
import { createHash } from 'node:crypto';

/** Independent test-only adapter: no SQLite schema, codec, connection or Registry. */
export class VersionStore implements MemoryHistoryStore {
  readonly heads = new Map<string, MemorySnapshot>();
  readonly versions = new Map<string, Map<number, MemorySnapshot>>();
  readonly receipts = new Map<string, MemoryReceipt>();
  read(memoryId: string, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    return Promise.resolve(structuredClone(this.heads.get(memoryId)));
  }
  getReceipt(memoryId: string, requestId: string, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    return Promise.resolve(
      structuredClone(this.receipts.get(JSON.stringify([memoryId, requestId])))
    );
  }
  commit(change: StoreCommit, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    const key = JSON.stringify([change.request.memoryId, change.request.requestId]);
    const old = this.receipts.get(key);
    if (old !== undefined) {
      assertReceiptMatches(old, change.request);
      return Promise.resolve(structuredClone(old));
    }
    const decision = decideMemoryCommit(this.heads.get(change.request.memoryId), change);
    const snapshot = structuredClone(decision.snapshot);
    this.heads.set(snapshot.memoryId, snapshot);
    const versions = this.versions.get(snapshot.memoryId) ?? new Map<number, MemorySnapshot>();
    if (!versions.has(snapshot.revision)) versions.set(snapshot.revision, snapshot);
    this.versions.set(snapshot.memoryId, versions);
    this.receipts.set(key, structuredClone(decision.receipt));
    return Promise.resolve(structuredClone(decision.receipt));
  }
  readVersion(reference: MemoryVersionReference, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    return Promise.resolve(
      structuredClone(this.versions.get(reference.memoryId)?.get(reference.revision))
    );
  }
  async listVersions(value: ListMemoryVersionsInput, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    const input = parseListMemoryVersionsInput(value);
    const head = await this.read(input.memoryId, signal);
    if (head === undefined) throw new ContextMemoryError('MEMORY_NOT_FOUND', 'Missing document.');
    const scope = createHash('sha256').update(input.memoryId).digest('hex');
    let upper = head.revision;
    let before = head.revision + 1;
    if (input.cursor !== undefined) {
      const cursor = jsonObject(JSON.parse(input.cursor));
      if (
        Object.keys(cursor).length !== 4 ||
        cursor.scope !== scope ||
        cursor.limit !== input.limit ||
        typeof cursor.upper !== 'number' ||
        !Number.isSafeInteger(cursor.upper) ||
        cursor.upper < 1 ||
        cursor.upper > head.revision ||
        typeof cursor.before !== 'number' ||
        !Number.isSafeInteger(cursor.before) ||
        cursor.before < 1 ||
        cursor.before > cursor.upper
      )
        throw new ContextMemoryError('INPUT_INVALID', 'Invalid consumer cursor.');
      upper = cursor.upper;
      before = cursor.before;
    }
    const all = [...(this.versions.get(input.memoryId)?.keys() ?? [])]
      .filter((revision) => revision <= upper && revision < before)
      .sort((a, b) => b - a);
    const revisions = all.slice(0, input.limit);
    const last = revisions.at(-1);
    return {
      memoryId: input.memoryId,
      throughRevision: upper,
      versions: revisions.map((revision) => ({ memoryId: input.memoryId, revision })),
      ...(all.length > input.limit && last !== undefined
        ? { nextCursor: JSON.stringify({ scope, limit: input.limit, upper, before: last }) }
        : {}),
    };
  }
  async fork(value: ForkMemoryInput, signal?: AbortSignal) {
    const { input, request } = parseMemoryForkRequest(value);
    const old = await this.getReceipt(input.memoryId, input.requestId, signal);
    if (old !== undefined) {
      assertReceiptMatches(old, request);
      return old;
    }
    const source = await this.readVersion(input.source, signal);
    if (source === undefined)
      throw new ContextMemoryError('MEMORY_VERSION_NOT_FOUND', 'Missing source.', {
        commit: { status: 'not-committed' },
      });
    return this.commit(
      {
        request,
        expectedRevision: null,
        state: { items: source.items, config: source.config, measurement: source.measurement },
        commandOutcomes: [],
      },
      signal
    );
  }
}
