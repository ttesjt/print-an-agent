import { parseAgentId } from '@ta-agent/base-identity';
import { jsonValue } from '@ta-agent/context-memory';
import type { AgentMemoryReference, MemoryManagementOptions } from './contracts/memory.js';
import { MemoryManagementError } from './memory-errors.js';
import { validateMemoryIdentifier } from './memory-target.js';

export function memoryManagementInput<I extends { readonly memoryId: string }>(
  input: I & { readonly agentId: string }
): { target: AgentMemoryReference; input: I } {
  try {
    jsonValue(input);
    const target = Object.freeze({
      agentId: parseAgentId(input.agentId),
      memoryId: validateMemoryIdentifier(input.memoryId),
    });
    const native = { ...structuredClone(input) };
    Reflect.deleteProperty(native, 'agentId');
    if ('requestId' in native) validateMemoryIdentifier(native.requestId);
    return { target, input: native };
  } catch (cause) {
    throw new MemoryManagementError('MEMORY_INPUT_INVALID', undefined, undefined, { cause });
  }
}

export function memoryManagementOptions(input?: MemoryManagementOptions): MemoryManagementOptions {
  if (input === undefined) return {};
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  )
    throw new MemoryManagementError('MEMORY_INPUT_INVALID', undefined);
  const keys = Reflect.ownKeys(input);
  if (keys.length === 0) return {};
  const descriptor = Object.getOwnPropertyDescriptor(input, 'signal');
  if (
    keys.length !== 1 ||
    keys[0] !== 'signal' ||
    !descriptor?.enumerable ||
    !('value' in descriptor) ||
    !(descriptor.value instanceof AbortSignal)
  )
    throw new MemoryManagementError('MEMORY_INPUT_INVALID', undefined);
  return { signal: descriptor.value };
}
