import type { BaseAgentRunContext } from '../types/context.js';
import { AgentDefinitionError } from '../types/errors.js';
import type {
  AgentOperationDefinition,
  AgentOperationName,
  AgentOperationReferenceMap,
  AgentRunContextInput,
  AgentRunContextOutput,
  DefineAgentOperationInput,
} from '../types/agent-operation.js';
import { AgentOperationReference } from '../types/agent-operation.js';

function validateOperationName(name: string): void {
  if (name.length === 0) {
    throw new AgentDefinitionError(
      'AGENT_OPERATION_NAME_INVALID',
      name,
      'Agent Operation names cannot be empty.'
    );
  }
}

export function defineAgentOperation<
  const TName extends AgentOperationName,
  const TExposure extends import('../types/agent-operation.js').AgentOperationExposure,
  TConfig,
  TResources,
  const TCallableOperations extends AgentOperationReferenceMap = Readonly<Record<never, never>>,
  C extends import('../types/context.js').AnyAgentRunContext = BaseAgentRunContext,
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

export function defineAgentOperationReference<
  const TName extends AgentOperationName,
  TInput,
  TOutput,
>(name: TName): AgentOperationReference<TName, TInput, TOutput> {
  validateOperationName(name);
  return new AgentOperationReference<TName, TInput, TOutput>(name);
}
