import type { MemoryDefinition, MemoryWorkflowOptions } from './types/workflow.js';
import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
} from '../../mutations/index.js';
import type { ReadContextInput, ReadContextResult } from '../../context/index.js';
import type { MutationResult } from '../../types/receipt.js';
import { memoryDefinition } from '../shared/index.js';

const skipped = (): MutationResult => ({ status: 'skipped', reason: 'condition-not-met' });

export function createMemoryCreateDefinition(
  options: MemoryWorkflowOptions<CreateMemoryInput, MutationResult, 'create'> = {}
): MemoryDefinition<CreateMemoryInput, MutationResult, 'create'> {
  return memoryDefinition(
    'context-memory.create',
    skipped,
    (r, input: CreateMemoryInput, signal) => r.memory.create(input, signal),
    options,
    true
  );
}

export function createMemoryApplyDefinition(
  options: MemoryWorkflowOptions<ApplyMemoryInput, MutationResult, 'apply'> = {}
): MemoryDefinition<ApplyMemoryInput, MutationResult, 'apply'> {
  return memoryDefinition(
    'context-memory.apply',
    skipped,
    (r, input: ApplyMemoryInput, signal) => r.memory.apply(input, signal),
    options,
    true
  );
}

export function createMemoryConfigureDefinition(
  options: MemoryWorkflowOptions<ConfigureMemoryInput, MutationResult, 'configure'> = {}
): MemoryDefinition<ConfigureMemoryInput, MutationResult, 'configure'> {
  return memoryDefinition(
    'context-memory.configure',
    skipped,
    (r, input: ConfigureMemoryInput, signal) => r.memory.configure(input, signal),
    options,
    true
  );
}

export function createMemoryReadContextDefinition(
  options: MemoryWorkflowOptions<
    ReadContextInput,
    ReadContextResult | undefined,
    'readContext'
  > = {}
): MemoryDefinition<ReadContextInput, ReadContextResult | undefined, 'readContext'> {
  return memoryDefinition(
    'context-memory.readContext',
    (): ReadContextResult | undefined => undefined,
    (r, input: ReadContextInput, signal) => r.memory.readContext(input, signal),
    options
  );
}
