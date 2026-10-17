import type { ItemCommand, MemoryItem, ModelEditOperation } from '../contracts/document.js';
import { ContextMemoryError } from '../errors.js';
import { parseItemCommands } from '../validation/commands.js';
import { keys, record } from '../validation/value.js';

/** A model returns operations, never a replacement state or system metadata. */
export function parseModelOperations(text: string): readonly ModelEditOperation[] {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) throw new Error('Expected an edit operations array.');
    for (const entry of value) {
      const command = record(entry, 'model operation');
      keys(
        command,
        command.op === 'remove'
          ? ['op', 'itemId']
          : command.op === 'add'
            ? ['op', 'content']
            : ['op', 'itemId', 'content']
      );
    }
    return parseItemCommands(value);
  } catch (cause) {
    throw new ContextMemoryError(
      'MODEL_OUTPUT_INVALID',
      'Model output must be a JSON edit operations list.',
      { cause }
    );
  }
}

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
