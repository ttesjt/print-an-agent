import {
  assertReceiptMatches,
  assertMemoryNotAborted,
  decideMemoryCommit,
  parseMemoryForkRequest,
  ContextMemoryError,
  type MemoryHistoryStore,
  type MemorySnapshot,
  type MemoryReceipt,
  type StoreCommit,
  type MemoryVersionReference,
  type ForkMemoryInput,
  type ListMemoryVersionsInput,
} from '@ta-agent/context-memory';

/** Independent consumer fixture: no SQLite, Registry, Profile or private Memory implementation. */
export class IndependentHistoryStore implements MemoryHistoryStore {
  readonly heads = new Map<string, MemorySnapshot>();
  readonly versions = new Map<string, Map<number, MemorySnapshot>>();
  readonly receipts = new Map<string, MemoryReceipt>();
  read(memoryId: string, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    return Promise.resolve(structuredClone(this.heads.get(memoryId)));
  }
  getReceipt(memoryId: string, requestId: string, signal?: AbortSignal) {
    const receipt = this.receipts.get(JSON.stringify([memoryId, requestId]));
    if (receipt === undefined) assertMemoryNotAborted(signal);
    return Promise.resolve(structuredClone(receipt));
  }
  commit(change: StoreCommit, signal?: AbortSignal): Promise<MemoryReceipt> {
    const key = JSON.stringify([change.request.memoryId, change.request.requestId]);
    const old = this.receipts.get(key);
    if (old !== undefined) {
      assertReceiptMatches(old, change.request);
      return Promise.resolve(structuredClone(old));
    }
    assertMemoryNotAborted(signal);
    // No await inside this fixture's atomic publication boundary.
    const { snapshot, receipt } = decideMemoryCommit(
      this.heads.get(change.request.memoryId),
      change
    );
    this.heads.set(snapshot.memoryId, structuredClone(snapshot));
    let history = this.versions.get(snapshot.memoryId);
    if (history === undefined) {
      history = new Map();
      this.versions.set(snapshot.memoryId, history);
    }
    history.set(snapshot.revision, structuredClone(snapshot));
    this.receipts.set(key, structuredClone(receipt));
    return Promise.resolve(structuredClone(receipt));
  }
  readVersion(reference: MemoryVersionReference, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    return Promise.resolve(
      structuredClone(this.versions.get(reference.memoryId)?.get(reference.revision))
    );
  }
  fork(input: ForkMemoryInput, signal?: AbortSignal): Promise<MemoryReceipt> {
    const { request } = parseMemoryForkRequest(input);
    const old = this.receipts.get(JSON.stringify([input.memoryId, input.requestId]));
    if (old !== undefined) {
      assertReceiptMatches(old, request);
      return Promise.resolve(structuredClone(old));
    }
    assertMemoryNotAborted(signal);
    const source = this.versions.get(input.source.memoryId)?.get(input.source.revision);
    if (source === undefined)
      throw new ContextMemoryError('MEMORY_VERSION_NOT_FOUND', 'Version not found.', {
        commit: { status: 'not-committed' },
      });
    return this.commit(
      {
        request,
        expectedRevision: null,
        commandOutcomes: [],
        state: { config: source.config, items: source.items, measurement: source.measurement },
      },
      signal
    );
  }
  listVersions(input: ListMemoryVersionsInput, signal?: AbortSignal) {
    assertMemoryNotAborted(signal);
    const head = this.heads.get(input.memoryId);
    if (head === undefined) throw new ContextMemoryError('MEMORY_NOT_FOUND', 'Memory not found.');
    const cursor: unknown =
      input.cursor === undefined
        ? { memoryId: input.memoryId, upper: head.revision, before: head.revision + 1 }
        : JSON.parse(input.cursor);
    if (
      typeof cursor !== 'object' ||
      cursor === null ||
      !('memoryId' in cursor) ||
      cursor.memoryId !== input.memoryId ||
      !('upper' in cursor) ||
      typeof cursor.upper !== 'number' ||
      !Number.isSafeInteger(cursor.upper) ||
      !('before' in cursor) ||
      typeof cursor.before !== 'number' ||
      !Number.isSafeInteger(cursor.before)
    )
      throw new ContextMemoryError('INPUT_INVALID', 'Invalid history cursor.');
    const upper = cursor.upper;
    const before = cursor.before;
    const selected = [...(this.versions.get(input.memoryId)?.keys() ?? [])]
      .filter((r) => r <= upper && r < before)
      .sort((a, b) => b - a);
    const revisions = selected.slice(0, input.limit ?? 20);
    return Promise.resolve({
      memoryId: input.memoryId,
      throughRevision: cursor.upper,
      versions: revisions.map((revision) => ({ memoryId: input.memoryId, revision })),
      ...(selected.length <= revisions.length
        ? {}
        : {
            nextCursor: JSON.stringify({
              memoryId: input.memoryId,
              upper: cursor.upper,
              before: revisions.at(-1),
            }),
          }),
    });
  }
}
