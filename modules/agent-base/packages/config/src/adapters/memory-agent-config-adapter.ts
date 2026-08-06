import type { AgentId } from '@ta-agent/base-identity';
import type {
  AgentConfigReadAdapter,
  AgentConfigWriteAdapter,
  AgentConfigWriteRequest,
} from '../types/adapter.js';
import type { AgentConfigSnapshot } from '../types/config.js';
import { AgentConfigError } from '../types/errors.js';

function cloneSnapshot(snapshot: AgentConfigSnapshot): AgentConfigSnapshot {
  return Object.freeze({
    ...snapshot,
    value: structuredClone(snapshot.value),
  });
}

export class MemoryAgentConfigAdapter implements AgentConfigReadAdapter, AgentConfigWriteAdapter {
  readonly #snapshots = new Map<AgentId, AgentConfigSnapshot>();

  read(agentId: AgentId): Promise<AgentConfigSnapshot | undefined> {
    const snapshot = this.#snapshots.get(agentId);
    return Promise.resolve(snapshot === undefined ? undefined : cloneSnapshot(snapshot));
  }

  write(request: AgentConfigWriteRequest): Promise<AgentConfigSnapshot> {
    const current = this.#snapshots.get(request.agentId);
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== request.expectedRevision) {
      throw new AgentConfigError(
        'CONFIG_REVISION_CONFLICT',
        `Expected config revision ${String(request.expectedRevision)} but found ${String(currentRevision)}.`
      );
    }

    const snapshot: AgentConfigSnapshot = Object.freeze({
      agentId: request.agentId,
      schemaVersion: request.schemaVersion,
      revision: (currentRevision ?? 0) + 1,
      value: structuredClone(request.value),
    });
    this.#snapshots.set(request.agentId, snapshot);
    return Promise.resolve(cloneSnapshot(snapshot));
  }
}
