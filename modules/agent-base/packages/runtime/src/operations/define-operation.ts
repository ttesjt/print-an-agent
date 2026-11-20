import { AgentDefinitionError } from '../errors.js';

import type {
  AgentRunContextInput,
  AgentRunContextOutput,
  AnyAgentRunContext,
  BaseAgentRunContext,
} from '../types/context.js';

import type { AgentOperationName, AgentOperationReferenceMap } from '../types/invocation.js';

import { AgentOperationReference } from './reference.js';

import type {
  AgentOperationDefinition,
  AgentOperationExposure,
  DefineAgentOperationInput,
} from './types/definition.js';

import { validateOperationName } from './validation.js';

export function defineAgentOperation<
  const TName extends AgentOperationName,
  const TExposure extends AgentOperationExposure,
  TConfig,
  TResources,
  const TCallableOperations extends AgentOperationReferenceMap = Readonly<Record<never, never>>,
  C extends AnyAgentRunContext = BaseAgentRunContext,
>(
  input: DefineAgentOperationInput<TName, TConfig, TResources, TCallableOperations, C> &
    Readonly<{ exposure: TExposure }>
): AgentOperationDefinition<
  TName,
  AgentRunContextInput<C>,
  AgentRunContextOutput<C>,
  TConfig,
  TResources,
  TCallableOperations,
  C
> &
  Readonly<{ exposure: TExposure }> {
  validateOperationName(input.name);
  if (input.reference !== undefined && input.reference.name !== input.name) {
    throw new AgentDefinitionError(
      'AGENT_OPERATION_REFERENCE_MISMATCH',
      input.name,
      `Agent Operation "${input.name}" cannot use reference "${input.reference.name}".`
    );
  }
  const reference =
    input.reference ??
    new AgentOperationReference<TName, AgentRunContextInput<C>, AgentRunContextOutput<C>>(
      input.name
    );
  return Object.freeze({
    ...input,
    reference,
    workflowPlan: Object.freeze([...input.workflowPlan]),
    callableOperations: Object.freeze(input.callableOperations ?? ({} as TCallableOperations)),
  });
}
