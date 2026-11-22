import type { CompactionTarget } from '../budget/index.js';
import type { ModelMemoryInput, ModelMemoryOperation, MemoryExperience } from './types/input.js';
import { parseRenderOptions } from '../document/index.js';
import { parseTokenTarget } from '../budget/index.js';
import { ContextMemoryError } from '../errors.js';
import { identity, jsonObject, jsonValue, keys, record } from '../values/index.js';
import type { ModelMemoryRequest } from './types/request.js';

export function parseCompactionTarget(value: unknown): CompactionTarget {
  const input = record(value, 'compaction target');
  const { render, measurementRef, ...tokens } = input;
  return {
    ...parseTokenTarget(tokens),
    ...('render' in input ? { render: parseRenderOptions(render) } : {}),
    ...('measurementRef' in input
      ? { measurementRef: identity(measurementRef, 'measurementRef') }
      : {}),
  };
}

export function parseModelMemoryRequest(
  operation: ModelMemoryOperation,
  value: ModelMemoryInput
): ModelMemoryRequest {
  const data = record(jsonValue(value), 'model memory input');
  const fields =
    operation === 'observe'
      ? ['context']
      : operation === 'edit'
        ? ['instruction', 'context']
        : ['target'];
  keys(data, ['memoryId', 'requestId', ...fields]);
  const memoryId = identity(data.memoryId, 'memoryId');
  const requestId = identity(data.requestId, 'requestId');
  let context: readonly MemoryExperience[] = [];
  if ('context' in data) {
    if (!Array.isArray(data.context))
      throw new ContextMemoryError('INPUT_INVALID', 'Memory context must be an array.');
    context = data.context.map((entry: unknown) => {
      const item = record(entry, 'experience');
      keys(item, ['role', 'content', 'source']);
      if (typeof item.content !== 'string')
        throw new ContextMemoryError('INPUT_INVALID', 'Experience content must be text.');
      return {
        role: identity(item.role, 'experience role'),
        content: item.content,
        ...('source' in item ? { source: jsonObject(item.source) } : {}),
      };
    });
  } else if (operation === 'observe')
    throw new ContextMemoryError('INPUT_INVALID', 'Observe requires context.');
  if (
    operation === 'edit' &&
    (typeof data.instruction !== 'string' || data.instruction.trim() === '')
  )
    throw new ContextMemoryError('INPUT_INVALID', 'Edit requires an instruction.');
  return {
    request: {
      memoryId,
      requestId,
      operation,
      input: jsonValue(
        Object.fromEntries(
          Object.entries(data).filter(([k]) => k !== 'memoryId' && k !== 'requestId')
        )
      ),
    },
    context,
    ...(typeof data.instruction === 'string' ? { instruction: data.instruction } : {}),
    ...('target' in data ? { target: parseCompactionTarget(data.target) } : {}),
  };
}
