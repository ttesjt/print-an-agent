import { bindTextTokenCounter } from '@print-an-agent/model-invocation-core';
import {
  createMemoryUpdatePort,
  resolveExecutionPolicy,
  refineMemoryCompactionTarget,
} from '../../model-update/index.js';
import { createContextMemoryResources } from '../deterministic/index.js';
import { ContextMemoryError } from '../../errors.js';
import { MAX_EXECUTION_TIMEOUT_MILLISECONDS } from '@print-an-agent/workflow-core';
import type { ModelMemoryResources, ModelMemoryResourceOptions } from './types/resources.js';

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
