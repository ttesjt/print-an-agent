import type { AgentIdentity } from '@print-an-agent/base-identity-config/identity';

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
