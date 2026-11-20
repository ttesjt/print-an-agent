import { AgentIdentityError } from '../errors.js';
import type { AgentIdentitySnapshot, AgentIdentityStatus } from './types/snapshot.js';
import type {
  CreateAgentIdentityOptions,
  TransitionAgentIdentityOptions,
} from './types/options.js';
import { assertSnapshotAgentId, normalizeCatalogSnapshot } from './snapshot.js';

export async function createAgentIdentity(
  options: CreateAgentIdentityOptions
): Promise<AgentIdentitySnapshot> {
  const snapshot = normalizeCatalogSnapshot(
    await options.catalog.create({ identity: options.identity })
  );
  assertSnapshotAgentId(snapshot, options.identity.id);
  if (snapshot.status !== 'active' || snapshot.revision !== 1) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'A newly created Agent Identity must be active at revision 1.'
    );
  }
  return snapshot;
}

async function transitionAgentIdentity(
  options: TransitionAgentIdentityOptions,
  status: AgentIdentityStatus
): Promise<AgentIdentitySnapshot> {
  const snapshot = normalizeCatalogSnapshot(
    await options.catalog.transition({
      agentId: options.agentId,
      status,
      expectedRevision: options.expectedRevision,
    })
  );
  assertSnapshotAgentId(snapshot, options.agentId);
  if (snapshot.status !== status || snapshot.revision !== options.expectedRevision + 1) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity catalog returned an invalid lifecycle transition result.'
    );
  }
  return snapshot;
}

export function disableAgentIdentity(
  options: TransitionAgentIdentityOptions
): Promise<AgentIdentitySnapshot> {
  return transitionAgentIdentity(options, 'disabled');
}

export function reactivateAgentIdentity(
  options: TransitionAgentIdentityOptions
): Promise<AgentIdentitySnapshot> {
  return transitionAgentIdentity(options, 'active');
}
