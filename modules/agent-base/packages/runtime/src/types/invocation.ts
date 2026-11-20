export type AgentOperationName = string;

export interface AgentRunOptions {
  readonly signal?: AbortSignal;
}

export type AgentOperationReferenceMap = Readonly<Record<string, object>>;

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
