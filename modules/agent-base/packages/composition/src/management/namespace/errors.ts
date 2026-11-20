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
