import {
  AgentSessionError,
  type SessionMemoryPort,
  type SessionLifecycleQueryPort,
  type RecoverSessionExecutionsInput,
  type SessionReference,
} from '@print-an-agent/base-session';
import type { CoordinatedSessionMaintenancePort } from '../contracts/session-management.js';
import type { ManagementOperationOptions } from '../contracts/operation.js';

/** Shared composition protocol, not Session-only recovery or a cross-authority transaction. */
export async function recoverSessionWithContextMemory(
  resources: {
    readonly session: SessionMemoryPort & SessionLifecycleQueryPort;
    readonly maintenance: CoordinatedSessionMaintenancePort;
    readonly resolveMemory: () => Promise<{
      recover(reference: SessionReference, signal?: AbortSignal): Promise<void>;
    }>;
  },
  input: RecoverSessionExecutionsInput,
  options: ManagementOperationOptions = {}
) {
  options.signal?.throwIfAborted();
  try {
    return await resources.maintenance.recoverSessionPersistence(input, options);
  } catch (cause) {
    // A failed CAS did not authorize a recovery owner. Only a recovery that actually fenced may proceed.
    if (!(cause instanceof AgentSessionError) || cause.code !== 'SESSION_RECOVERY_FAILED')
      throw cause;
    options.signal?.throwIfAborted();
    const pending = await resources.session.listPendingMemoryRecords(input);
    const state = await resources.session.inspectSession(input);
    if (
      !pending.length ||
      state?.execution.state !== 'recovering' ||
      state.execution.activeLeaseCount !== 0
    )
      throw cause;
    const memory = await resources.resolveMemory();
    options.signal?.throwIfAborted();
    await memory.recover({ agentId: input.agentId, sessionId: input.sessionId }, options.signal);
    options.signal?.throwIfAborted();
    const repaired = await resources.session.inspectSession(input);
    if (repaired === undefined) throw cause;
    return resources.maintenance.recoverSessionPersistence(
      { ...input, expectedExecutionRevision: repaired.execution.revision },
      options
    );
  }
}
