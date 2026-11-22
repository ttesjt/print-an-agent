import type { ItemCommand } from '../document/index.js';
import type { MemoryItem } from '../types/document.js';
import { ContextMemoryError } from '../errors.js';
import { parseItemCommands } from '../document/index.js';

/** Planner replacements edit content only. Public apply still replaces the complete item. */
export function projectModelOperations(
  items: readonly MemoryItem[],
  commands: readonly ItemCommand[]
): readonly ItemCommand[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return parseItemCommands(commands).map((command) => {
    if ('metadata' in command)
      throw new ContextMemoryError('MODEL_OUTPUT_INVALID', 'Models cannot write metadata.');
    if (command.op !== 'replace') return command;
    const existing = byId.get(command.itemId);
    if (existing === undefined)
      throw new ContextMemoryError('ITEM_NOT_FOUND', 'Model operation references an unknown item.');
    return {
      ...command,
      ...(existing.metadata === undefined ? {} : { metadata: existing.metadata }),
    };
  });
}
