import { parseAgentId } from '../../lib/identity.js';
import { AgentIdentityError } from '../../types/errors.js';
import type { AgentId, AgentIdentitySnapshot } from '../../types/identity.js';
import type {
  AgentIdentityCatalogPort,
  CreateAgentIdentityRequest,
  TransitionAgentIdentityRequest,
} from '../contracts.js';
import { defineAgentIdentitySnapshot, isAgentIdentityStatus } from '../snapshot.js';

export interface MemoryAgentIdentityCatalogAdapterOptions {
  readonly clock?: () => number;
}

function readClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_CONFIGURATION_INVALID',
      'Agent Identity clock must return a non-negative safe integer timestamp.'
    );
  }
  return timestamp;
}

function cloneSnapshot(snapshot: AgentIdentitySnapshot): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: snapshot.identity,
    status: snapshot.status,
    revision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });
}

export class MemoryAgentIdentityCatalogAdapter implements AgentIdentityCatalogPort {
  readonly #clock: () => number;
  readonly #snapshots = new Map<AgentId, AgentIdentitySnapshot>();

  constructor(options: MemoryAgentIdentityCatalogAdapterOptions = {}) {
    this.#clock = options.clock ?? Date.now;
  }

  create(request: CreateAgentIdentityRequest): Promise<AgentIdentitySnapshot> {
    const agentId = parseAgentId(request.identity.id);
    if (this.#snapshots.has(agentId)) {
      throw new AgentIdentityError(
        'AGENT_IDENTITY_ALREADY_EXISTS',
        `Agent Identity "${agentId}" already exists.`
      );
    }
    const timestamp = readClock(this.#clock);
    const snapshot = defineAgentIdentitySnapshot({
      identity: request.identity,
      status: 'active',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.#snapshots.set(agentId, snapshot);
    return Promise.resolve(cloneSnapshot(snapshot));
  }

  read(agentIdInput: AgentId): Promise<AgentIdentitySnapshot | undefined> {
    const agentId = parseAgentId(agentIdInput);
    const snapshot = this.#snapshots.get(agentId);
    return Promise.resolve(snapshot === undefined ? undefined : cloneSnapshot(snapshot));
  }

  list(): Promise<readonly AgentIdentitySnapshot[]> {
    return Promise.resolve(
      Object.freeze(
        [...this.#snapshots.values()]
          .sort((left, right) => left.identity.id.localeCompare(right.identity.id))
          .map(cloneSnapshot)
      )
    );
  }

  transition(request: TransitionAgentIdentityRequest): Promise<AgentIdentitySnapshot> {
    const agentId = parseAgentId(request.agentId);
    if (!isAgentIdentityStatus(request.status)) {
      throw new AgentIdentityError(
        'AGENT_IDENTITY_STATUS_TRANSITION_INVALID',
        'Agent Identity lifecycle target is invalid.'
      );
    }
    const current = this.#snapshots.get(agentId);
    if (current === undefined) {
      throw new AgentIdentityError(
        'AGENT_IDENTITY_NOT_FOUND',
        `Agent Identity "${agentId}" does not exist.`
      );
    }
    if (current.revision !== request.expectedRevision) {
      throw new AgentIdentityError(
        'AGENT_IDENTITY_REVISION_CONFLICT',
        `Expected Agent Identity revision ${request.expectedRevision} but found ${current.revision}.`
      );
    }
    if (current.status === request.status) {
      throw new AgentIdentityError(
        'AGENT_IDENTITY_STATUS_TRANSITION_INVALID',
        `Agent Identity "${agentId}" is already ${request.status}.`
      );
    }
    const updated = defineAgentIdentitySnapshot({
      ...current,
      identity: current.identity,
      status: request.status,
      revision: current.revision + 1,
      updatedAt: readClock(this.#clock),
    });
    this.#snapshots.set(agentId, updated);
    return Promise.resolve(cloneSnapshot(updated));
  }
}
