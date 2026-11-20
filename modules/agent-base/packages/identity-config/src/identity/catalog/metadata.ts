import { defineAgentIdentity } from '../values.js';
import { AgentIdentityError } from '../errors.js';
import type { AgentIdentitySnapshot } from './types/snapshot.js';
import type { RenameAgentIdentityOptions } from './types/options.js';
import { readAgentIdentity } from './queries.js';
import { assertSnapshotAgentId, defineAgentIdentitySnapshot } from './snapshot.js';

/** Metadata updates never change stable identity, lifecycle, or creation authority. */
export async function renameAgentIdentity(
  options: RenameAgentIdentityOptions
): Promise<AgentIdentitySnapshot> {
  const identity = defineAgentIdentity({ id: options.agentId, displayName: options.displayName });
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_CONFIGURATION_INVALID',
      'Invalid expected revision.'
    );
  }
  if (options.catalog.rename === undefined) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_METADATA_UNSUPPORTED',
      'This Identity catalog does not support display-name updates.'
    );
  }
  const current = await readAgentIdentity(options);
  if (current.revision !== options.expectedRevision) {
    throw new AgentIdentityError('AGENT_IDENTITY_REVISION_CONFLICT', 'Identity revision changed.');
  }
  const snapshot = defineAgentIdentitySnapshot(
    await options.catalog.rename({
      agentId: identity.id,
      displayName: identity.displayName,
      expectedRevision: options.expectedRevision,
    })
  );
  assertSnapshotAgentId(snapshot, identity.id);
  if (
    snapshot.identity.displayName !== identity.displayName ||
    snapshot.revision !== current.revision + 1 ||
    snapshot.status !== current.status ||
    snapshot.createdAt !== current.createdAt
  ) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      'Identity metadata adapter changed unrelated authority or returned invalid metadata.'
    );
  }
  return snapshot;
}
