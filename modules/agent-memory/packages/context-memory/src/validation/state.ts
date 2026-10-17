import type { MemoryMeasurement, MemorySnapshot, MemoryState } from '../contracts/document.js';
import { resolveMemoryConfig } from '../config/parse.js';
import { digestValue, equalValue } from '../domain/digest.js';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryItems } from './items.js';
import { identity, integer, jsonValue, keys, record } from './value.js';

export function parseMemoryState(value: unknown): MemoryState {
  const input = record(value, 'memory state');
  keys(input, ['config', 'items', 'measurement']);
  const config = resolveMemoryConfig(input.config);
  if (!equalValue(config, input.config))
    throw new ContextMemoryError(
      'INPUT_INVALID',
      'Persisted configuration must be fully normalized.'
    );
  const items = parseMemoryItems(input.items);
  const measured = record(input.measurement, 'measurement');
  keys(measured, [
    'tokenizerRef',
    'rendererRef',
    'renderDigest',
    'itemsDigest',
    'tokenCount',
    'itemTokenCounts',
  ]);
  const counts = jsonValue(measured.itemTokenCounts);
  if (!Array.isArray(counts) || counts.length !== items.length)
    throw new ContextMemoryError('INPUT_INVALID', 'Measurement must match all items.');
  const itemTokenCounts = counts.map((value: unknown, index: number) => {
    const count = record(value, 'item count');
    keys(count, ['itemId', 'contentDigest', 'tokenCount']);
    const item = items[index];
    if (
      item === undefined ||
      count.itemId !== item.id ||
      count.contentDigest !== digestValue(item.content)
    )
      throw new ContextMemoryError('INPUT_INVALID', 'Item measurement identity mismatch.');
    return {
      itemId: item.id,
      contentDigest: identity(count.contentDigest, 'contentDigest'),
      tokenCount: integer(count.tokenCount, 'item count'),
    };
  });
  const measurement: MemoryMeasurement = {
    tokenizerRef: identity(measured.tokenizerRef, 'tokenizerRef'),
    rendererRef: identity(measured.rendererRef, 'rendererRef'),
    renderDigest: identity(measured.renderDigest, 'renderDigest'),
    itemsDigest: identity(measured.itemsDigest, 'itemsDigest'),
    tokenCount: integer(measured.tokenCount, 'token count'),
    itemTokenCounts,
  };
  if (
    measurement.tokenizerRef !== config.tokenizerRef ||
    measurement.renderDigest !== digestValue(config.render) ||
    measurement.itemsDigest !== digestValue(items)
  )
    throw new ContextMemoryError('INPUT_INVALID', 'Snapshot measurement identity mismatch.');
  return { config, items, measurement };
}
export function parseMemorySnapshot(value: unknown): MemorySnapshot {
  const input = record(value, 'snapshot');
  keys(input, ['memoryId', 'revision', 'config', 'items', 'measurement']);
  return {
    memoryId: identity(input.memoryId, 'memoryId'),
    revision: integer(input.revision, 'revision', 1),
    ...parseMemoryState({
      config: input.config,
      items: input.items,
      measurement: input.measurement,
    }),
  };
}
