import type { ModelEditOperation } from '../types/operations.js';
import { ContextMemoryError } from '../../errors.js';
import { parseItemCommands } from '../../document/index.js';
import { keys, record } from '../../values/index.js';

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
