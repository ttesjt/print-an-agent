import type { WorkflowLifecycle } from '@print-an-agent/workflow-core';
import { preserveMemoryCommit } from './output.js';
import type { MemoryOperationOutput } from './types/output.js';

export function memoryLifecycle<C extends { state: MemoryOperationOutput<unknown> }>(
  hooks: WorkflowLifecycle<C> = {}
): WorkflowLifecycle<C> {
  const invoke = async (hook: ((context: C) => void | Promise<void>) | undefined, context: C) => {
    if (hook === undefined) return;
    const output = structuredClone(context.state.operationOutput?.value);
    try {
      await hook(context);
    } catch (cause) {
      throw preserveMemoryCommit(cause, output);
    }
  };
  return {
    ...hooks,
    onSuccess: (context) => invoke(hooks.onSuccess, context),
    onFinally: (context) => invoke(hooks.onFinally, context),
  };
}
