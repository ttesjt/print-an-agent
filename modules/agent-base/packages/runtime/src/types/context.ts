import type { AgentIdentity } from '@ta-agent/base-identity';
import type { AgentTraceEmitter } from '@ta-agent/base-observability';
import type {
  AgentOperationInvoker,
  AgentOperationName,
  AgentOperationReferenceMap,
} from './agent-operation.js';

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
