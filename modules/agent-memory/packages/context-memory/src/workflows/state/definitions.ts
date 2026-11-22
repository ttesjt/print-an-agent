import type { createContextMemoryStateResources } from './create-resources.js';
import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { MemoryStepName, MemoryWorkflowState } from '../shared/index.js';
import type { MemoryReceipt } from '../../types/receipt.js';
import { memoryDefinition } from '../shared/index.js';
import type { MemoryStateWorkflowOptions, GetMemoryReceiptInput } from './types.js';
import type { MemorySnapshot } from '../../types/document.js';

export function createMemoryInspectDefinition(
  options: MemoryStateWorkflowOptions<
    { readonly memoryId: string },
    MemorySnapshot | undefined,
    'inspect'
  > = {}
): BundleWorkflowDefinition<
  MemoryStepName,
  { readonly memoryId: string },
  MemoryWorkflowState<{ readonly memoryId: string }, MemorySnapshot | undefined>,
  {
    readonly memory: Pick<
      ReturnType<typeof createContextMemoryStateResources>['memory'],
      'inspect'
    >;
  },
  MemorySnapshot | undefined
> {
  return memoryDefinition(
    'context-memory.inspect',
    (): MemorySnapshot | undefined => undefined,
    (r, input: { readonly memoryId: string }, signal) => r.memory.inspect(input, signal),
    options
  );
}

export function createMemoryGetReceiptDefinition(
  options: MemoryStateWorkflowOptions<
    GetMemoryReceiptInput,
    MemoryReceipt | undefined,
    'getReceipt'
  > = {}
): BundleWorkflowDefinition<
  MemoryStepName,
  GetMemoryReceiptInput,
  MemoryWorkflowState<GetMemoryReceiptInput, MemoryReceipt | undefined>,
  {
    readonly memory: Pick<
      ReturnType<typeof createContextMemoryStateResources>['memory'],
      'getReceipt'
    >;
  },
  MemoryReceipt | undefined
> {
  return memoryDefinition(
    'context-memory.getReceipt',
    (): MemoryReceipt | undefined => undefined,
    (r, input: GetMemoryReceiptInput, signal) => r.memory.getReceipt(input, signal),
    options,
    true
  );
}
