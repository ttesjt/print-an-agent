/** Public logical reference; independent of Config revision, runtime generation and storage path. */
export interface AgentMemoryReference {
  readonly agentId: string;
  readonly memoryId: string;
}
export interface ManagedMemoryResult<T> {
  readonly target: AgentMemoryReference;
  /** Native domain result, including its original authority IDs and receipt digest. */
  readonly value: T;
}
