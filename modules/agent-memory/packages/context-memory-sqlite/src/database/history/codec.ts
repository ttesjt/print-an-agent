import { HISTORY_RECORD_FORMAT } from './format.js';
import { createHash } from 'node:crypto';
import { canonicalJson, jsonValue, parseMemorySnapshot } from '@print-an-agent/context-memory';
import type { MemorySnapshot } from '@print-an-agent/context-memory';
import { applyStateDelta, diffState } from './delta/index.js';
import type { HistoryRecord } from './types/record.js';

export function snapshotDigest(snapshot: MemorySnapshot): string {
  return createHash('sha256')
    .update(canonicalJson(jsonValue(snapshot)))
    .digest('hex');
}

export function encodeHistory(
  snapshot: MemorySnapshot,
  previous: MemorySnapshot | undefined,
  previousDepth: number,
  maxDeltaChain: number
): HistoryRecord {
  const base = canonicalJson(jsonValue(snapshot));
  const delta =
    previous === undefined
      ? undefined
      : JSON.stringify(diffState(jsonValue(previous), jsonValue(snapshot)));
  const useDelta =
    delta !== undefined &&
    previousDepth < maxDeltaChain &&
    Buffer.byteLength(delta) < Buffer.byteLength(base);
  return {
    memoryId: snapshot.memoryId,
    revision: snapshot.revision,
    format: HISTORY_RECORD_FORMAT,
    kind: useDelta ? 'delta' : 'base',
    previousRevision: previous?.revision ?? null,
    depth: useDelta ? previousDepth + 1 : 0,
    digest: snapshotDigest(snapshot),
    payload: useDelta ? delta : base,
  };
}

export function decodeHistory(
  row: HistoryRecord,
  previous?: MemorySnapshot,
  previousDepth = 0
): MemorySnapshot {
  if (
    row.format !== HISTORY_RECORD_FORMAT ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !Number.isSafeInteger(row.depth) ||
    row.depth < 0 ||
    (row.previousRevision !== null && row.previousRevision !== row.revision - 1)
  )
    throw new Error('Invalid history envelope.');
  let value: unknown = JSON.parse(row.payload);
  if (row.kind === 'delta') {
    if (
      previous === undefined ||
      previous.memoryId !== row.memoryId ||
      previous.revision !== row.previousRevision ||
      row.depth !== previousDepth + 1
    )
      throw new Error('Broken history chain.');
    value = applyStateDelta(jsonValue(previous), value);
  } else if (row.kind !== 'base' || row.depth !== 0) throw new Error('Invalid history baseline.');
  const snapshot = parseMemorySnapshot(value);
  if (
    snapshot.memoryId !== row.memoryId ||
    snapshot.revision !== row.revision ||
    snapshotDigest(snapshot) !== row.digest
  )
    throw new Error('History scope or digest mismatch.');
  return snapshot;
}
