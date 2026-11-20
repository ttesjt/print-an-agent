import type { AgentIdentity } from '@print-an-agent/base-identity-config/identity';

import type { AgentTraceEmitter } from '@print-an-agent/base-observability';

import type {
  AgentOperationInvoker,
  AgentOperationName,
  AgentOperationReferenceMap,
} from './invocation.js';

export interface BaseAgentRunContext<
  TInput = unknown,
  TOutput = unknown,
  TCallableOperations extends AgentOperationReferenceMap = Readonly<Record<never, never>>,
> {
  readonly identity: AgentIdentity;
  readonly operationName: AgentOperationName;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly input: TInput;
  output?: TOutput;
  readonly signal: AbortSignal;
  readonly operations: AgentOperationInvoker<TCallableOperations>;
  readonly traceEmitter?: AgentTraceEmitter;
}

export type AnyAgentRunContext = BaseAgentRunContext<unknown, unknown>;

export type AgentRunContextInput<C extends AnyAgentRunContext> = C['input'];
export type AgentRunContextOutput<C extends AnyAgentRunContext> = Required<C>['output'];
