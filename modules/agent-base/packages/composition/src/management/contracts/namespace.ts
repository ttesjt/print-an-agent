import type { AgentId } from '@ta-agent/base-identity';

export type ManagedAgentNamespaceErrorCode = 'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS';

/** A stable failure emitted by application-owned namespace adapters. */
export class ManagedAgentNamespaceError extends Error {
  readonly code: ManagedAgentNamespaceErrorCode;

  constructor(code: ManagedAgentNamespaceErrorCode, message: string) {
    super(message);
    this.name = 'ManagedAgentNamespaceError';
    this.code = code;
  }
}

/** A lifecycle-neutral reference to application-owned resources for one Agent. */
export interface ManagedAgentNamespaceReference<THandle> {
  readonly agentId: AgentId;
  readonly handle: THandle;
}

/** A namespace allocation that has not yet crossed its publication boundary. */
export interface StagedManagedAgentNamespace<
  THandle,
> extends ManagedAgentNamespaceReference<THandle> {
  readonly phase: 'staged';
  readonly resumed: boolean;
}

/** A namespace that has crossed its publication boundary and can be resolved publicly. */
export interface ManagedAgentNamespace<THandle> extends ManagedAgentNamespaceReference<THandle> {
  readonly phase: 'published';
}

/**
 * Allocates and resolves Agent resource namespaces without prescribing their storage medium.
 *
 * The handle may identify a directory, database tenant, remote resource, or product-owned value.
 */
export interface ManagedAgentNamespacePort<THandle> {
  /**
   * Atomically reserves an unpublished namespace.
   *
   * An adapter must throw `MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS` when an already-published
   * namespace prevents this reservation. A previously staged allocation may instead be resumed.
   */
  stage(agentId: AgentId): Promise<StagedManagedAgentNamespace<THandle>>;

  /**
   * Atomically crosses the namespace publication boundary.
   *
   * When this operation rejects, the namespace must remain unpublished and abortable. Once it
   * resolves, callers must treat the Agent as published even if later Projection coordination fails.
   */
  publish(staged: StagedManagedAgentNamespace<THandle>): Promise<ManagedAgentNamespace<THandle>>;
  abort(staged: StagedManagedAgentNamespace<THandle>): Promise<void>;
  resolve(agentId: AgentId): Promise<ManagedAgentNamespace<THandle> | undefined>;
  list(): Promise<readonly ManagedAgentNamespace<THandle>[]>;
}
