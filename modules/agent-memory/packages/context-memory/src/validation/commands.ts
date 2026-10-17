import type { ItemCommand, ItemContent } from '../contracts/document.js';
import { ContextMemoryError } from '../errors.js';
import { identity, jsonObject, jsonValue, keys, record } from './value.js';

export function parseItemContent(value: unknown): ItemContent {
  const object = record(value, 'item');
  keys(object, ['content', 'metadata']);
  if (typeof object.content !== 'string')
    throw new ContextMemoryError('INPUT_INVALID', 'Item content must be a string.');
  return {
    content: object.content,
    ...('metadata' in object ? { metadata: jsonObject(object.metadata) } : {}),
  };
}
export function parseItemCommands(value: unknown): readonly ItemCommand[] {
  if (!Array.isArray(value))
    throw new ContextMemoryError('COMMAND_INVALID', 'Commands must be an array.');
  const targets = new Set<string>();
  try {
    const entries = jsonValue(value);
    if (!Array.isArray(entries))
      throw new ContextMemoryError('COMMAND_INVALID', 'Commands must be an array.');
    return entries.map((entry: unknown): ItemCommand => {
      const object = record(entry, 'command');
      if (object.op === 'remove') {
        keys(object, ['op', 'itemId']);
      } else if (object.op === 'add' || object.op === 'replace') {
        keys(
          object,
          object.op === 'add'
            ? ['op', 'content', 'metadata']
            : ['op', 'itemId', 'content', 'metadata']
        );
      } else throw new ContextMemoryError('COMMAND_INVALID', 'Unknown edit operation.');
      let itemId: string | undefined;
      if (object.op !== 'add') {
        itemId = identity(object.itemId, 'itemId');
        if (targets.has(itemId))
          throw new ContextMemoryError(
            'COMMAND_INVALID',
            'A batch cannot target an item more than once.'
          );
        targets.add(itemId);
      }
      if (object.op === 'remove') return { op: 'remove', itemId: identity(itemId, 'itemId') };
      const content = parseItemContent({
        content: object.content,
        ...('metadata' in object ? { metadata: object.metadata } : {}),
      });
      return object.op === 'add'
        ? { op: 'add', ...content }
        : { op: 'replace', itemId: identity(itemId, 'itemId'), ...content };
    });
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.code === 'COMMAND_INVALID') throw cause;
    throw new ContextMemoryError('COMMAND_INVALID', 'Invalid edit operations.', { cause });
  }
}
