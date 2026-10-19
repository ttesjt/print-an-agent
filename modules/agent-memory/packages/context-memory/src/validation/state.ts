import type { MemoryMeasurement, MemorySnapshot, MemoryState } from '../contracts/document.js';
import { resolveMemoryConfig } from '../config/parse.js';
import { digestValue, equalValue } from '../domain/digest.js';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryItems } from './items.js';
import { identity, integer, jsonValue, keys, record } from './value.js';
import {
  requireTokenMeasurement,
  TOKEN_MEASUREMENT_SCOPE,
  TEXT_TOKEN_INPUT_CONTRACT,
  type TokenMeasurement,
} from '@ta-agent/model-invocation-core';
import { assertMemoryBudget } from '../domain/budget.js';

function parseMeasurement(
  value: Readonly<Record<string, unknown>>,
  measurementRef: string
): TokenMeasurement {
  try {
    return requireTokenMeasurement(
      {
        measurementRef: value.measurementRef,
        inputProtocolRef: value.inputProtocolRef,
        scope: value.scope,
        tokens: value.tokens,
        accuracy: value.accuracy,
      },
      {
        measurementRef,
        inputProtocolRef: TEXT_TOKEN_INPUT_CONTRACT.ref,
        scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
      }
    );
  } catch (cause: unknown) {
    throw new ContextMemoryError('INPUT_INVALID', 'Invalid stored text measurement.', { cause });
  }
}

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
    'measurementRef',
    'inputProtocolRef',
    'scope',
    'accuracy',
    'rendererRef',
    'renderDigest',
    'itemsDigest',
    'tokens',
    'itemTokenCounts',
  ]);
  const counts = jsonValue(measured.itemTokenCounts);
  if (!Array.isArray(counts) || counts.length !== items.length)
    throw new ContextMemoryError('INPUT_INVALID', 'Measurement must match all items.');
  const itemTokenCounts = counts.map((value: unknown, index: number) => {
    const count = record(value, 'item count');
    keys(count, [
      'itemId',
      'contentDigest',
      'tokens',
      'measurementRef',
      'inputProtocolRef',
      'scope',
      'accuracy',
    ]);
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
      ...parseMeasurement(count, config.measurementRef),
    };
  });
  const measurement: MemoryMeasurement = {
    ...parseMeasurement(measured, config.measurementRef),
    rendererRef: identity(measured.rendererRef, 'rendererRef'),
    renderDigest: identity(measured.renderDigest, 'renderDigest'),
    itemsDigest: identity(measured.itemsDigest, 'itemsDigest'),
    itemTokenCounts,
  };
  if (
    measurement.measurementRef !== config.measurementRef ||
    measurement.renderDigest !== digestValue(config.render) ||
    measurement.itemsDigest !== digestValue(items)
  )
    throw new ContextMemoryError('INPUT_INVALID', 'Snapshot measurement identity mismatch.');
  assertMemoryBudget(items, config, measurement);
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
