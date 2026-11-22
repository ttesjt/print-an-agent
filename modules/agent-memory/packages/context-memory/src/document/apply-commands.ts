import { randomUUID } from 'node:crypto';
import type { ItemCommand, AppliedCommands } from './types/commands.js';
import type { CommandOutcome } from '../types/receipt.js';
import type { MemoryItem } from '../types/document.js';
import { ContextMemoryError } from '../errors.js';
import { parseItemCommands } from './parse-commands.js';
import { parseMemoryItems } from './items.js';
import { identity, equalValue } from '../values/index.js';

export function applyItemCommands(
  base: readonly MemoryItem[],
  input: readonly ItemCommand[],
  createId: () => string = randomUUID
): AppliedCommands {
  const items = parseMemoryItems(base);
  const commands = parseItemCommands(input);
  const original = new Map(items.map((item) => [item.id, item]));
  // Validate every reference before allocating IDs or applying any command.
  for (const command of commands) {
    if (command.op !== 'add' && !original.has(command.itemId))
      throw new ContextMemoryError('ITEM_NOT_FOUND', 'Edit target was not found.', {
        details: { itemId: command.itemId },
      });
  }
  const usedIds = new Set(original.keys());
  const current = new Map(original);
  const appended: MemoryItem[] = [];
  const commandOutcomes = commands.map((command, commandIndex): CommandOutcome => {
    if (command.op === 'add') {
      if (command.content.trim() === '') return { commandIndex, outcome: 'ignored' };
      const id = identity(createId(), 'generated item id');
      if (usedIds.has(id))
        throw new ContextMemoryError('INPUT_INVALID', 'Item ID generator produced a duplicate.');
      usedIds.add(id);
      appended.push({
        id,
        content: command.content,
        ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      });
      return { commandIndex, outcome: 'added', itemId: id };
    }
    const itemId = command.itemId;
    if (command.op === 'remove' || command.content.trim() === '') {
      current.delete(itemId);
      return { commandIndex, outcome: 'removed', itemId };
    }
    const replacement: MemoryItem = {
      id: itemId,
      content: command.content,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
    };
    current.set(itemId, replacement);
    return {
      commandIndex,
      itemId,
      outcome: equalValue(original.get(itemId), replacement) ? 'unchanged' : 'updated',
    };
  });
  return { items: [...current.values(), ...appended], commandOutcomes };
}
