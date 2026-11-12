import {
  bindTextTokenCounter,
  type TextTokenInput,
  type TokenCounter,
} from '@print-an-agent/model-invocation-core';
import type { ExecutionPolicy } from '../contracts/document.js';
import type { MemoryPlanner } from '../contracts/model.js';
import type { MemoryMutationResources } from '../domain/mutations.js';
import { createMemoryUpdatePort, type MemoryUpdatePort } from '../domain/update.js';
import { resolveExecutionPolicy } from '../config/parse.js';
import {
  refineMemoryCompactionTarget,
  type MemoryCompactionFeedback,
} from '../planning/feedback.js';
import { createContextMemoryResources, type MemoryWorkflowResources } from './resources.js';
import { ContextMemoryError } from '../errors.js';
import { MAX_EXECUTION_TIMEOUT_MILLISECONDS } from '@print-an-agent/workflow-core';

export interface ModelMemoryResources extends MemoryWorkflowResources {
  readonly updates: MemoryUpdatePort;
  readonly planner: MemoryPlanner;
  readonly policy: ExecutionPolicy;
  readonly refine: (feedback: MemoryCompactionFeedback) => number | Promise<number>;
  /** Only for the optional experience/instruction input budget, not output acceptance. */
  readonly inputCounter?: TokenCounter<TextTokenInput>;
}
export interface ModelMemoryResourceOptions extends MemoryMutationResources {
  readonly planner: MemoryPlanner;
  readonly policy?: Partial<ExecutionPolicy>;
  readonly refine?: ModelMemoryResources['refine'];
  readonly inputCounter?: TokenCounter<TextTokenInput>;
}
export function createModelMemoryResources(
  options: ModelMemoryResourceOptions
): ModelMemoryResources {
  const policy = Object.freeze(resolveExecutionPolicy(options.policy));
  if (policy.timeoutMs !== null && policy.timeoutMs > MAX_EXECUTION_TIMEOUT_MILLISECONDS)
    throw new ContextMemoryError(
      'CONFIG_INVALID',
      'Memory deadline exceeds the supported timer range.'
    );
  if (typeof options.planner?.plan !== 'function')
    throw new ContextMemoryError('CONFIG_INVALID', 'A Memory planner is required.');
  if (policy.maxInputTokens !== null && options.inputCounter === undefined)
    throw new ContextMemoryError(
      'CONFIG_INVALID',
      'An explicit input counter is required for maxInputTokens.'
    );
  return Object.freeze({
    ...createContextMemoryResources(options),
    updates: createMemoryUpdatePort(options),
    planner: Object.freeze({ plan: options.planner.plan.bind(options.planner) }),
    policy,
    refine: options.refine ?? refineMemoryCompactionTarget,
    ...(options.inputCounter === undefined
      ? {}
      : { inputCounter: bindTextTokenCounter(options.inputCounter) }),
  });
}
