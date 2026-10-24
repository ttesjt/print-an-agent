import { setImmediate as yieldTurn } from 'node:timers/promises';
import {
  assertNotAborted,
  decideRetrievalPublication,
  assertCanonicalVector,
  matchesMetadata,
  parseMetadataFilter,
  canonical,
  RetrievalMemoryError,
  type RetrievalBackend,
  type RetrievalSpace,
  type StoredEntry,
  type RetrievalReceipt,
  type RetrievalHit,
} from '@ta-agent/retrieval-memory';
/** Test-only remote-shaped endpoint. No filesystem, SQLite, path or connection in its port. */
export function opaqueBackend() {
  const spaces = new Map<string, RetrievalSpace>();
  const entries = new Map<string, StoredEntry>();
  const receipts = new Map<string, RetrievalReceipt>();
  const key = (a: string, b: string) => JSON.stringify([a, b]);
  let closing = false;
  let count = 0;
  let drained: (() => void) | undefined;
  const faults = { dropReply: false };
  async function remote<T>(signal: AbortSignal | undefined, work: () => T): Promise<T> {
    assertNotAborted(signal);
    if (closing) throw new RetrievalMemoryError('STORAGE_FAILED', 'Remote test binding is closed.');
    count++;
    try {
      await yieldTurn();
      assertNotAborted(signal);
      return structuredClone(work());
    } finally {
      if (--count === 0) drained?.();
    }
  }
  const space = (id: string) => {
    const value = spaces.get(id);
    if (value === undefined) throw new RetrievalMemoryError('MEMORY_NOT_FOUND', 'Space not found.');
    return value;
  };
  const backend: RetrievalBackend = {
    inspect: (memoryId, signal) => remote(signal, () => spaces.get(memoryId)),
    get: (memoryId, entryId, signal) => remote(signal, () => entries.get(key(memoryId, entryId))),
    getReceipt: (memoryId, requestId, signal) =>
      remote(signal, () => receipts.get(key(memoryId, requestId))),
    publish: (candidate, signal) =>
      remote(signal, () => {
        const { mutation } = candidate;
        const { memoryId, requestId } = mutation.input;
        const entryId =
          candidate.entry?.entryId ?? ('entryId' in mutation.input ? mutation.input.entryId : null);
        const decision = decideRetrievalPublication(
          spaces.get(memoryId),
          entryId === null ? undefined : entries.get(key(memoryId, entryId)),
          receipts.get(key(memoryId, requestId)),
          candidate
        );
        if ('space' in decision) {
          spaces.set(memoryId, decision.space);
          if (entryId !== null) {
            if (decision.stored === null) entries.delete(key(memoryId, entryId));
            else entries.set(key(memoryId, entryId), decision.stored);
          }
          receipts.set(key(memoryId, requestId), decision.receipt);
        }
        if (faults.dropReply) {
          faults.dropReply = false;
          throw new Error('Simulated remote reply loss.');
        }
        return decision.receipt;
      }),
    list: (input, signal) =>
      remote(signal, () => {
        const manifest = space(input.memoryId);
        let after = '';
        if (input.cursor !== undefined) {
          const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as {
            memoryId: string;
            sequence: number;
            after: string;
          };
          if (cursor.memoryId !== manifest.memoryId || cursor.sequence !== manifest.sequence)
            throw new RetrievalMemoryError('STALE_CURSOR', 'Cursor view changed.');
          after = cursor.after;
        }
        const ordered = [...entries.values()]
          .filter(
            (item) =>
              item.entry.memoryId === input.memoryId &&
              Buffer.compare(Buffer.from(item.entry.entryId), Buffer.from(after)) > 0
          )
          .sort((a, b) =>
            Buffer.compare(Buffer.from(a.entry.entryId), Buffer.from(b.entry.entryId))
          );
        const selected = ordered.slice(0, input.limit).map(({ entry }) => ({
          memoryId: entry.memoryId,
          entryId: entry.entryId,
          revision: entry.revision,
          metadata: entry.metadata,
          source: entry.source,
        }));
        return {
          space: manifest,
          entries: selected,
          nextCursor:
            ordered.length > input.limit
              ? Buffer.from(
                  JSON.stringify({
                    memoryId: manifest.memoryId,
                    sequence: manifest.sequence,
                    after: selected.at(-1)!.entryId,
                  })
                ).toString('base64url')
              : null,
        };
      }),
    search: (input, signal) =>
      remote(signal, () => {
        const manifest = space(input.space.memoryId);
        if (
          canonical(manifest.index) !== canonical(input.space.index) ||
          manifest.revision !== input.space.revision
        )
          throw new RetrievalMemoryError('REVISION_CONFLICT', 'Index changed.');
        assertCanonicalVector(input.vector, manifest.index.dimensions);
        const filter = input.filter === undefined ? undefined : parseMetadataFilter(input.filter);
        const hits: RetrievalHit[] = [];
        for (const { entry, representation } of entries.values()) {
          if (
            entry.memoryId !== manifest.memoryId ||
            (filter !== undefined && !matchesMetadata(entry.metadata, filter))
          )
            continue;
          for (const { vector, ...chunk } of representation.chunks)
            hits.push({
              ...chunk,
              source: entry.source,
              ranking: {
                metricRef: manifest.index.metricRef,
                value: 1 - vector.reduce((dot, value, i) => dot + value * input.vector[i]!, 0),
                order: 'ascending',
                strategyRef: 'opaque-test:exhaustive:v1',
              },
            });
        }
        hits.sort(
          (a, b) =>
            a.ranking.value - b.ranking.value ||
            Buffer.compare(Buffer.from(a.entryId), Buffer.from(b.entryId)) ||
            a.ordinal - b.ordinal
        );
        return { space: manifest, hits: hits.slice(0, input.topK) };
      }),
  };
  return {
    backend,
    faults,
    async close() {
      closing = true;
      if (count > 0)
        await new Promise<void>((resolve) => {
          drained = resolve;
        });
    },
  };
}
