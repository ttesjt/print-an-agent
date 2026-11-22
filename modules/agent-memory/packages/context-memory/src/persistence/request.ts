import { MEMORY_OPERATIONS } from '../mutation-operations.js';
import type { MutationRequest, CommandOutcome } from '../types/receipt.js';
import { ContextMemoryError } from '../errors.js';
import { identity, integer, jsonValue, keys, record, digestValue } from '../values/index.js';

export function parseMutationRequest(value: unknown): MutationRequest {
  const input = record(value, 'request');
  keys(input, ['memoryId', 'requestId', 'operation', 'input']);
  const operation = MEMORY_OPERATIONS.find((operation) => operation === input.operation);
  if (operation === undefined)
    throw new ContextMemoryError('INPUT_INVALID', 'Unknown mutation operation.');
  return {
    memoryId: identity(input.memoryId, 'memoryId'),
    requestId: identity(input.requestId, 'requestId'),
    operation,
    input: jsonValue(input.input),
  };
}

export function requestDigest(request: MutationRequest): string {
  const parsed = parseMutationRequest(request);
  return digestValue({ operation: parsed.operation, input: parsed.input });
}

export function parseCommandOutcomes(value: unknown): readonly CommandOutcome[] {
  const entries = jsonValue(value);
  if (!Array.isArray(entries))
    throw new ContextMemoryError('INPUT_INVALID', 'commandOutcomes must be an array.');
  return entries.map((value: unknown, index: number): CommandOutcome => {
    const entry = record(value, 'command outcome');
    keys(entry, ['commandIndex', 'outcome', 'itemId']);
    const commandIndex = integer(entry.commandIndex, 'commandIndex');
    if (commandIndex !== index)
      throw new ContextMemoryError('INPUT_INVALID', 'Command outcomes must be in input order.');
    if (entry.outcome === 'ignored') {
      if ('itemId' in entry)
        throw new ContextMemoryError('INPUT_INVALID', 'Ignored commands have no item identity.');
      return { commandIndex, outcome: 'ignored' };
    }
    const outcomes = ['added', 'updated', 'removed', 'unchanged'] as const;
    const outcome = outcomes.find((outcome) => outcome === entry.outcome);
    if (outcome === undefined)
      throw new ContextMemoryError('INPUT_INVALID', 'Unknown command outcome.');
    return { commandIndex, outcome, itemId: identity(entry.itemId, 'outcome itemId') };
  });
}
