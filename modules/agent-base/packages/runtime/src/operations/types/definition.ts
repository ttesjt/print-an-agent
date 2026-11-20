import type { AgentIdentity } from '@print-an-agent/base-identity-config/identity';

import type { AgentTraceEmitter } from '@print-an-agent/base-observability';

import type {
  AgentRunContextInput,
  AgentRunContextOutput,
  AnyAgentRunContext,
  BaseAgentRunContext,
} from '../../types/context.js';

import type {
  AgentOperationInvoker,
  AgentOperationName,
  AgentOperationReferenceMap,
} from '../../types/invocation.js';

import type { AgentWorkflow } from '../../workflows/index.js';

import type { AgentOperationReference } from '../reference.js';

import type {
  AgentOperationRunErrorMapper,
  AgentOperationRunExecutor,
  AgentOperationRunPreparer,
} from './execution.js';

export type AgentOperationExposure = 'public' | 'internal';

export interface AgentRunContextFactoryInput<
  TInput,
  TConfig,
  TResources,
  TCallableOperations extends AgentOperationReferenceMap,
> {
  readonly identity: AgentIdentity;
  readonly operationName: AgentOperationName;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly input: TInput;
  readonly signal: AbortSignal;
  readonly config: TConfig;
  readonly resources: TResources;
  readonly operations: AgentOperationInvoker<TCallableOperations>;
  readonly traceEmitter: AgentTraceEmitter;
}

export type AgentRunContextFactory<
  TInput,
  TConfig,
  TResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends BaseAgentRunContext<TInput>,
> = (input: AgentRunContextFactoryInput<TInput, TConfig, TResources, TCallableOperations>) => C;

export interface AgentOperationDefinition<
  TName extends AgentOperationName,
  TInput,
  TOutput,
  TConfig,
  TResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends BaseAgentRunContext<TInput, TOutput>,
> {
  readonly name: TName;
  readonly exposure: AgentOperationExposure;
  readonly reference: AgentOperationReference<TName, TInput, TOutput>;
  readonly workflowPlan: readonly AgentWorkflow<C>[];
  readonly config: TConfig;
  readonly resources: TResources;
  readonly callableOperations: TCallableOperations;
  readonly createContext: AgentRunContextFactory<
    TInput,
    TConfig,
    TResources,
    TCallableOperations,
    C
  >;
  /** Validates or normalizes input while observing the effective execution signal. */
  readonly prepareRun?: AgentOperationRunPreparer<TInput, TConfig, TResources>;
  readonly executeRun?: AgentOperationRunExecutor<TInput, TConfig, TResources>;
  readonly mapRunError?: AgentOperationRunErrorMapper<TInput, TConfig, TResources>;
  readonly createRunId?: () => string;
}

export type AnyAgentOperationDefinition = AgentOperationDefinition<
  AgentOperationName,
  never,
  unknown,
  unknown,
  unknown,
  AgentOperationReferenceMap,
  never
>;

export type AgentOperationDefinitionMap = Readonly<Record<string, object>>;

export interface DefineAgentOperationInput<
  TName extends AgentOperationName,
  TConfig,
  TResources,
  TCallableOperations extends AgentOperationReferenceMap,
  C extends AnyAgentRunContext,
> {
  readonly name: TName;
  readonly exposure: AgentOperationExposure;
  readonly reference?: AgentOperationReference<
    TName,
    AgentRunContextInput<C>,
    AgentRunContextOutput<C>
  >;
  readonly workflowPlan: readonly AgentWorkflow<C>[];
  readonly config: TConfig;
  readonly resources: TResources;
  readonly callableOperations?: TCallableOperations;
  readonly createContext: AgentRunContextFactory<
    AgentRunContextInput<C>,
    TConfig,
    TResources,
    TCallableOperations,
    C
  >;
  /** Validates or normalizes input while observing the effective execution signal. */
  readonly prepareRun?: AgentOperationRunPreparer<AgentRunContextInput<C>, TConfig, TResources>;
  readonly executeRun?: AgentOperationRunExecutor<AgentRunContextInput<C>, TConfig, TResources>;
  readonly mapRunError?: AgentOperationRunErrorMapper<AgentRunContextInput<C>, TConfig, TResources>;
  readonly createRunId?: () => string;
}
