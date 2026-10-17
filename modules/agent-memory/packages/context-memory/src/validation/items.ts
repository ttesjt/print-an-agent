import type { MemoryItem } from '../contracts/document.js';
import { ContextMemoryError } from '../errors.js';
import { parseItemContent } from './commands.js';
import { identity, jsonValue, keys, record } from './value.js';

export function parseMemoryItems(value: unknown): readonly MemoryItem[] {
  const entries = jsonValue(value);
  if (!Array.isArray(entries))
    throw new ContextMemoryError('INPUT_INVALID', 'Items must be an array.');
  const ids = new Set<string>();
  return entries.map((entry: unknown) => {
    const input = record(entry, 'item');
    keys(input, ['id', 'content', 'metadata']);
    const id = identity(input.id, 'item id');
    if (ids.has(id)) throw new ContextMemoryError('INPUT_INVALID', 'Duplicate item identity.');
    ids.add(id);
    const content = parseItemContent({
      content: input.content,
      ...('metadata' in input ? { metadata: input.metadata } : {}),
    });
    if (content.content.trim() === '')
      throw new ContextMemoryError('INPUT_INVALID', 'Stored items must not be blank.');
    return { id, ...content };
  });
}
