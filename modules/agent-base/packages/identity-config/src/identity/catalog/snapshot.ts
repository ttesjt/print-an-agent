import { defineAgentIdentity } from '../values.js';
import { AgentIdentityError } from '../errors.js';
import type { AgentId } from '../types/identity.js';
import type { AgentIdentitySnapshot, AgentIdentityStatus } from './types/snapshot.js';

export function isAgentIdentityStatus(value: unknown): value is AgentIdentityStatus {
  return value === 'active' || value === 'disabled';
}

export function validateIdentityRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity revision must be a positive safe integer.'
    );
  }
  return value as number;
}

export function validateIdentityTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      `Agent Identity ${label} must be a non-negative safe integer.`
    );
  }
  return value as number;
}

export function defineAgentIdentitySnapshot(input: {
  readonly identity: Readonly<{ id: unknown; displayName?: unknown }>;
  readonly status: unknown;
  readonly revision: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}): AgentIdentitySnapshot {
  if (typeof input.identity.id !== 'string' || typeof input.identity.displayName !== 'string') {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity snapshot contains an invalid identity.'
    );
  }
  const identity = defineAgentIdentity({
    id: input.identity.id,
    displayName: input.identity.displayName,
  });
  if (!isAgentIdentityStatus(input.status)) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity snapshot contains an invalid lifecycle status.'
    );
  }
  const revision = validateIdentityRevision(input.revision);
  const createdAt = validateIdentityTimestamp(input.createdAt, 'createdAt');
  const updatedAt = validateIdentityTimestamp(input.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity updatedAt cannot precede createdAt.'
    );
  }
  return Object.freeze({ identity, status: input.status, revision, createdAt, updatedAt });
}

export function assertSnapshotAgentId(snapshot: AgentIdentitySnapshot, agentId: AgentId): void {
  if (snapshot.identity.id !== agentId) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      `Agent Identity catalog returned "${snapshot.identity.id}" while resolving "${agentId}".`
    );
  }
}

export function normalizeCatalogSnapshot(snapshot: AgentIdentitySnapshot): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: snapshot.identity,
    status: snapshot.status,
    revision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });
}
