export interface AgentMemoryStorageBinding {
  /** Ephemeral Profiles use their opaque allocation token, durable Profiles a stable namespace key. */
  readonly key: string | symbol;
  readonly contextPath: string;
  readonly retrievalPath: string;
}
