import type { MemoryItem } from '../types/document.js';
import type { MemoryChanges } from '../types/receipt.js';
import { equalValue } from '../values/index.js';

export function summarizeMemoryChanges(
  before: readonly MemoryItem[],
  after: readonly MemoryItem[]
): MemoryChanges {
  const previous = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  return {
    addedItemIds: after.filter((item) => !previous.has(item.id)).map((item) => item.id),
    updatedItemIds: after
      .filter((item) => previous.has(item.id) && !equalValue(item, previous.get(item.id)))
      .map((item) => item.id),
    removedItemIds: before.filter((item) => !next.has(item.id)).map((item) => item.id),
  };
}
