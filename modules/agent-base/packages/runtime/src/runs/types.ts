import type { AgentId, AgentIdentity } from '@print-an-agent/base-identity-config/identity';

import type { AgentTraceRuntimeOptions } from '@print-an-agent/base-observability';

import type { AgentRunOptions } from '../types/invocation.js';

export interface InvocationLineage {
  readonly parentRunId?: string;
  readonly operationNames: readonly string[];
  readonly signal?: AbortSignal;
}

export interface OperationExecutionState<TInput> {
  input: TInput;
  signal: AbortSignal;
}

/** The narrow lookup capability borrowed by a Run, without Agent registration ownership. */
export interface InvocableAgentOperation {
  readonly name: string;
  readonly execute: (
    input: unknown,
    options: AgentRunOptions,
    lineage: InvocationLineage
  ) => Promise<unknown>;
}
export type AgentOperationResolver = (reference: object) => InvocableAgentOperation | undefined;
export interface AgentRunEnvironment {
  readonly resolveAgentId: () => AgentId;
  readonly identity: AgentIdentity;
  readonly observability: AgentTraceRuntimeOptions;
  readonly resolveOperation: AgentOperationResolver;
}
