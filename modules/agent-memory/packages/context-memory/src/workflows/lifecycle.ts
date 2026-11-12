import type { WorkflowLifecycle } from '@print-an-agent/workflow-core';
import { preserveMemoryCommit } from './outcome.js';

export function memoryLifecycle<C extends { result: unknown }>(
  hooks: WorkflowLifecycle<C> = {}
): WorkflowLifecycle<C> {
  const invoke = async (hook: ((context: C) => void | Promise<void>) | undefined, context: C) => {
    if (hook === undefined) return;
    const result = structuredClone(context.result);
    try {
      await hook(context);
    } catch (cause) {
      throw preserveMemoryCommit(cause, result);
    }
  };
  return {
    ...hooks,
    onSuccess: (context) => invoke(hooks.onSuccess, context),
    onFinally: (context) => invoke(hooks.onFinally, context),
  };
}
