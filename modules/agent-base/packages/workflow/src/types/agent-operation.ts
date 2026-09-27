import type { AgentIdentity } from '@ta-agent/base-identity';
import type { AgentTraceEmitter } from '@ta-agent/base-observability';
import type { AnyAgentRunContext, BaseAgentRunContext } from './context.js';
import type { RunnableWorkflow } from './workflow.js';

export type AgentOperationName = string;
export type AgentOperationExposure = 'public' | 'internal';

export interface AgentRunOptions {
  readonly signal?: AbortSignal;
}

export interface AgentOperationRunPreparationInput<TInput, TConfig, TResources> {
  readonly identity: AgentIdentity;
  readonly input: TInput;
  readonly signal: AbortSignal;
  readonly config: TConfig;
  readonly resources: TResources;
}

export interface PreparedAgentOperationRun<TInput> {
  readonly input: TInput;
}

export type AgentOperationRunPreparer<TInput, TConfig, TResources> = (
  input: AgentOperationRunPreparationInput<TInput, TConfig, TResources>
) => Promise<PreparedAgentOperationRun<TInput>>;

export interface AgentOperationRunErrorMapperInput<TInput, TConfig, TResources> {
  readonly identity: AgentIdentity;
  readonly input: TInput;
  readonly signal: AbortSignal;
  readonly config: TConfig;
  readonly resources: TResources;
}

export type AgentOperationRunErrorMapper<TInput, TConfig, TResources> = (
  error: unknown,
  input: AgentOperationRunErrorMapperInput<TInput, TConfig, TResources>
) => unknown;

export interface AgentOperationRunExecution<
  TInput,
  TConfig,
  TResources,
> extends AgentOperationRunPreparationInput<TInput, TConfig, TResources> {
  readonly execute: (signal: AbortSignal) => Promise<void>;
}

export type AgentOperationRunExecutor<TInput, TConfig, TResources> = (
  execution: AgentOperationRunExecution<TInput, TConfig, TResources>
) => Promise<void>;

export class AgentOperationReference<TName extends AgentOperationName, TInput, TOutput> {
  readonly name: TName;

  // The declaration retains the invocation contract for inference without a runtime value.
  declare readonly contract: Readonly<{ input: TInput; output: TOutput }>;

  constructor(name: TName) {
    this.name = name;
    Object.freeze(this);
  }
}

export type AgentOperationReferenceMap = Readonly<Record<string, object>>;

export type AgentRunContextInput<C extends AnyAgentRunContext> = C['input'];
export type AgentRunContextOutput<C extends AnyAgentRunContext> = Required<C>['output'];

export type AgentOperationInput<TReference> =
  TReference extends Readonly<{ contract: Readonly<{ input: infer TInput }> }> ? TInput : never;

export type AgentOperationOutput<TReference> =
  TReference extends Readonly<{ contract: Readonly<{ output: infer TOutput }> }> ? TOutput : never;

export interface AgentOperationInvoker<TReferences extends AgentOperationReferenceMap> {
  invoke<TName extends keyof TReferences & string>(
    name: TName,
    input: AgentOperationInput<TReferences[TName]>,
    options?: AgentRunOptions
  ): Promise<AgentOperationOutput<TReferences[TName]>>;
}

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
  readonly workflowPlan: readonly RunnableWorkflow<C>[];
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

export type AgentOperationInputFromDefinition<TDefinition> =
  TDefinition extends Readonly<{
    reference: Readonly<{ contract: Readonly<{ input: infer TInput }> }>;
  }>
    ? TInput
    : never;

export type AgentOperationOutputFromDefinition<TDefinition> =
  TDefinition extends Readonly<{
    reference: Readonly<{ contract: Readonly<{ output: infer TOutput }> }>;
  }>
    ? TOutput
    : never;

export type PublicAgentOperationName<TDefinitions extends AgentOperationDefinitionMap> = {
  [TName in keyof TDefinitions]: TDefinitions[TName] extends Readonly<{
    exposure: 'public';
  }>
    ? TName
    : never;
}[keyof TDefinitions] &
  string;

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
  readonly workflowPlan: readonly RunnableWorkflow<C>[];
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
