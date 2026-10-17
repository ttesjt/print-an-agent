import {
  assertMemoryNotAborted,
  assertReceiptMatches,
  decideMemoryCommit,
  type MemoryStore,
  type MemorySnapshot,
  type MemoryReceipt,
  type StoreCommit,
} from '@ta-agent/context-memory';

/** Test-only persistence; production qualification uses the actual SQLite adapter. */
export class TestMemoryStore implements MemoryStore {
  readonly snapshots = new Map<string, MemorySnapshot>();
  readonly receipts = new Map<string, MemoryReceipt>();
  commits = 0;
  beforeRead?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
  afterCommit?: () => void;
  async read(memoryId: string, signal?: AbortSignal): Promise<MemorySnapshot | undefined> {
    await this.beforeRead?.();
    assertMemoryNotAborted(signal);
    return structuredClone(this.snapshots.get(memoryId));
  }
  getReceipt(
    memoryId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined> {
    assertMemoryNotAborted(signal);
    return Promise.resolve(
      structuredClone(this.receipts.get(JSON.stringify([memoryId, requestId])))
    );
  }
  async commit(change: StoreCommit, signal?: AbortSignal): Promise<MemoryReceipt> {
    await this.beforeCommit?.();
    assertMemoryNotAborted(signal);
    const key = JSON.stringify([change.request.memoryId, change.request.requestId]);
    const existing = this.receipts.get(key);
    if (existing !== undefined) {
      assertReceiptMatches(existing, change.request);
      return structuredClone(existing);
    }
    const result = decideMemoryCommit(this.snapshots.get(change.request.memoryId), change);
    this.snapshots.set(change.request.memoryId, structuredClone(result.snapshot));
    this.receipts.set(key, structuredClone(result.receipt));
    this.commits++;
    this.afterCommit?.();
    return result.receipt;
  }
}

export function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
