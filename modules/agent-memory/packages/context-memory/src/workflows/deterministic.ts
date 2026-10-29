import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
  ReadContextInput,
  ReadContextResult,
} from '../contracts/inputs.js';
import type { MemoryReceipt, MutationResult } from '../contracts/receipt.js';
import { memoryDefinition, type MemoryWorkflowOptions } from './definition.js';
import type { GetMemoryReceiptInput } from './resources.js';
import type { MemorySnapshot } from '../contracts/document.js';

export function createMemoryInspectDefinition(
  options: MemoryWorkflowOptions<
    { readonly memoryId: string },
    MemorySnapshot | undefined,
    'inspect'
  > = {}
) {
  return memoryDefinition(
    'context-memory.inspect',
    (): MemorySnapshot | undefined => undefined,
    (r, input: { readonly memoryId: string }, signal) => r.memory.inspect(input, signal),
    options
  );
}

const skipped = (): MutationResult => ({ status: 'skipped', reason: 'condition-not-met' });
export function createMemoryCreateDefinition(
  options: MemoryWorkflowOptions<CreateMemoryInput, MutationResult, 'create'> = {}
) {
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
) {
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
) {
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
) {
  return memoryDefinition(
    'context-memory.readContext',
    (): ReadContextResult | undefined => undefined,
    (r, input: ReadContextInput, signal) => r.memory.readContext(input, signal),
    options
  );
}
export function createMemoryGetReceiptDefinition(
  options: MemoryWorkflowOptions<
    GetMemoryReceiptInput,
    MemoryReceipt | undefined,
    'getReceipt'
  > = {}
) {
  return memoryDefinition(
    'context-memory.getReceipt',
    (): MemoryReceipt | undefined => undefined,
    (r, input: GetMemoryReceiptInput, signal) => r.memory.getReceipt(input, signal),
    options,
    true
  );
}
