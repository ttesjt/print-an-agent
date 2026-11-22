import type { MemoryMutationResources } from '../mutations/index.js';
import type { ModelMemoryInput, ModelMemoryOperation } from './types/input.js';
import { parseModelMemoryRequest } from './input.js';
import { loadMemory, mutationResult, replayMutation } from '../persistence/index.js';
import { ContextMemoryError, assertMemoryNotAborted } from '../errors.js';
import { MemoryUpdate } from './candidate.js';
import type { MemoryUpdatePort } from './types/update.js';

export function createMemoryUpdatePort(resources: MemoryMutationResources): MemoryUpdatePort {
  return Object.freeze({
    async begin(operation: ModelMemoryOperation, input: ModelMemoryInput, signal: AbortSignal) {
      try {
        assertMemoryNotAborted(signal);
        const parsed = parseModelMemoryRequest(operation, input);
        const known = await replayMutation(resources.store, parsed.request, signal);
        if (known !== undefined)
          return { status: 'replayed' as const, result: mutationResult(known) };
        const source = await loadMemory(resources.store, parsed.request.memoryId, signal);
        const raced = await replayMutation(resources.store, parsed.request, signal);
        if (raced !== undefined)
          return { status: 'replayed' as const, result: mutationResult(raced) };
        return {
          status: 'candidate' as const,
          update: new MemoryUpdate(resources, parsed, source),
        };
      } catch (cause) {
        if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
        assertMemoryNotAborted(signal);
        throw new ContextMemoryError(
          cause instanceof ContextMemoryError ? cause.code : 'INPUT_INVALID',
          'Memory update could not be prepared.',
          { cause, commit: { status: 'not-committed' } }
        );
      }
    },
  });
}
