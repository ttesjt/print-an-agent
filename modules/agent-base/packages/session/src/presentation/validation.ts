import { AgentSessionError } from '../errors.js';
import { enumerableDataProperty, isPlainRecord } from '../validation/data-record.js';
import type { SessionReasoningBlock, SessionTurnPresentation } from './types.js';

/** Total readable text in UTF-16 code units, not a per-block allowance. */
export const MAX_SESSION_PRESENTATION_CHARACTERS = 64_000;
/** Separately bounds structural overhead when many turns contain very short reasoning. */
export const MAX_SESSION_PRESENTATION_BLOCKS = 1_024;

export function defineSessionTurnPresentation(input: unknown): SessionTurnPresentation {
  requireRecord(input, ['reasoningBlocks']);
  const blocks = dataField(input, 'reasoningBlocks');
  if (!Array.isArray(blocks) || Object.getPrototypeOf(blocks) !== Array.prototype) return invalid();
  if (blocks.length === 0) return invalid();
  if (blocks.length > MAX_SESSION_PRESENTATION_BLOCKS) return limitExceeded();
  if (Reflect.ownKeys(blocks).length !== blocks.length + 1) return invalid();
  const normalized: SessionReasoningBlock[] = [];
  let previousIndex = 0;
  let characters = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = dataField(blocks, String(index));
    requireRecord(block, ['modelTurnIndex', 'text']);
    const modelTurnIndex = dataField(block, 'modelTurnIndex');
    const text = dataField(block, 'text');
    if (
      typeof modelTurnIndex !== 'number' ||
      !Number.isSafeInteger(modelTurnIndex) ||
      modelTurnIndex <= previousIndex ||
      typeof text !== 'string' ||
      text.length === 0
    )
      return invalid();
    characters += text.length;
    if (characters > MAX_SESSION_PRESENTATION_CHARACTERS) return limitExceeded();
    normalized.push(Object.freeze({ modelTurnIndex, text }));
    previousIndex = modelTurnIndex;
  }
  return Object.freeze({ reasoningBlocks: Object.freeze(normalized) });
}

function requireRecord(input: unknown, fields: readonly string[]): asserts input is object {
  if (!isPlainRecord(input)) return invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return invalid();
}

function dataField(input: object, key: string): unknown {
  const descriptor = enumerableDataProperty(input, key);
  if (descriptor === undefined) return invalid();
  return descriptor.value;
}

function limitExceeded(): never {
  throw new AgentSessionError(
    'SESSION_PRESENTATION_LIMIT_EXCEEDED',
    'Session presentation exceeded its storage bound.'
  );
}

function invalid(): never {
  throw new AgentSessionError('SESSION_PRESENTATION_INVALID', 'Session presentation is invalid.');
}
