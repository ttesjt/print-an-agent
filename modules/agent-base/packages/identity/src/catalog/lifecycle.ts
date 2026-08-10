import type { AgentIdentitySnapshot, AgentIdentityStatus } from '../types/identity.js';
import { AgentIdentityError } from '../types/errors.js';
import type {
  CreateAgentIdentityOptions,
  ReadAgentIdentityOptions,
  TransitionAgentIdentityOptions,
} from './contracts.js';
import { assertSnapshotAgentId, defineAgentIdentitySnapshot } from './snapshot.js';

function validateSnapshot(snapshot: AgentIdentitySnapshot): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: snapshot.identity,
    status: snapshot.status,
    revision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });
}

export async function createAgentIdentity(
  options: CreateAgentIdentityOptions
): Promise<AgentIdentitySnapshot> {
  const snapshot = validateSnapshot(await options.catalog.create({ identity: options.identity }));
  assertSnapshotAgentId(snapshot, options.identity.id);
  if (snapshot.status !== 'active' || snapshot.revision !== 1) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'A newly created Agent Identity must be active at revision 1.'
    );
  }
  return snapshot;
}

export async function readAgentIdentity(
  options: ReadAgentIdentityOptions
): Promise<AgentIdentitySnapshot> {
  const found = await options.catalog.read(options.agentId);
  if (found === undefined) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_NOT_FOUND',
      `Agent Identity "${options.agentId}" does not exist.`
    );
  }
  const snapshot = validateSnapshot(found);
  assertSnapshotAgentId(snapshot, options.agentId);
  return snapshot;
}

export async function listAgentIdentities(
  catalog: ReadAgentIdentityOptions['catalog']
): Promise<readonly AgentIdentitySnapshot[]> {
  const snapshots = (await catalog.list()).map(validateSnapshot);
  const ids = snapshots.map((snapshot) => snapshot.identity.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => {
      const previous = ids[index - 1];
      return previous !== undefined && id <= previous;
    })
  ) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Agent Identity catalog list must contain unique snapshots ordered by Agent ID.'
    );
  }
  return Object.freeze(snapshots);
}

async function transitionAgentIdentity(
  options: TransitionAgentIdentityOptions,
  status: AgentIdentityStatus
): Promise<AgentIdentitySnapshot> {
  const snapshot = validateSnapshot(
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
