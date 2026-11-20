import { AgentIdentityError } from '../errors.js';
import type { AgentIdentitySnapshot } from './types/snapshot.js';
import type { ReadAgentIdentityOptions } from './types/options.js';
import { assertSnapshotAgentId, normalizeCatalogSnapshot } from './snapshot.js';

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
  const snapshot = normalizeCatalogSnapshot(found);
  assertSnapshotAgentId(snapshot, options.agentId);
  return snapshot;
}

export async function listAgentIdentities(
  catalog: ReadAgentIdentityOptions['catalog']
): Promise<readonly AgentIdentitySnapshot[]> {
  const snapshots = (await catalog.list()).map(normalizeCatalogSnapshot);
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
