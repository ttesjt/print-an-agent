import { AgentRunError } from '../errors.js';

import type {
  AgentOperationInput,
  AgentOperationInvoker,
  AgentOperationOutput,
  AgentOperationReferenceMap,
  AgentRunOptions,
} from '../types/invocation.js';

import type { AgentOperationResolver, InvocationLineage } from './types.js';

export function createOperationInvoker<TReferences extends AgentOperationReferenceMap>(
  resolveOperation: AgentOperationResolver,
  references: TReferences,
  lineage: InvocationLineage
): AgentOperationInvoker<TReferences> {
  return Object.freeze({
    invoke: <TName extends keyof TReferences & string>(
      name: TName,
      input: AgentOperationInput<TReferences[TName]>,
      options: AgentRunOptions = {}
    ): Promise<AgentOperationOutput<TReferences[TName]>> => {
      const reference = references[name];
      if (reference === undefined) {
        return Promise.reject(
          new AgentRunError(
            'AGENT_OPERATION_NOT_CALLABLE',
            `Agent Operation "${name}" is not callable from this Agent Run.`,
            name
          )
        );
      }
      const target = resolveOperation(reference);
      if (target === undefined || target.name !== name) {
        return Promise.reject(
          new AgentRunError(
            'AGENT_OPERATION_NOT_CALLABLE',
            `Agent Operation "${name}" is not callable from this Agent Run.`,
            name
          )
        );
      }
      return target.execute(input, options, lineage) as Promise<
        AgentOperationOutput<TReferences[TName]>
      >;
    },
  });
}
