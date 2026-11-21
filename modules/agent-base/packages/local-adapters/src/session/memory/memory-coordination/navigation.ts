import {
  AgentSessionError,
  decideMemoryRecord,
  type AppliedSessionNavigation,
  type PublishSessionMemoryNavigation,
} from '@print-an-agent/base-session';
import { advanceMemoryExecution } from '../lifecycle/state.js';
import { applyMemorySessionNavigation } from '../navigation/apply.js';
import { readMemoryClock } from '../state/clock.js';
import { memorySessionKey } from '../state/lookup.js';
import type { MemorySessionAuthority } from '../types/lifecycle.js';
import type { MemorySessionState } from '../types/state.js';

export function publishMemorySessionNavigation(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  input: PublishSessionMemoryNavigation
): Promise<AppliedSessionNavigation> {
  return Promise.resolve().then(() => {
    const session =
      input.execution === undefined ? authority.require(input) : authority.assertWrite(input);
    if (
      session.lifecycle.status !== 'active' ||
      (input.execution === undefined && session.executions.size !== 0) ||
      session.turns.some((turn) => turn.status === 'active')
    )
      throw new AgentSessionError('SESSION_BUSY', 'Memory navigation requires an idle Session.');
    const key = JSON.stringify(['navigation', input.intentId]);
    const intent = session.memoryRecords.get(key);
    if (intent === undefined || intent.settled || intent.revision !== input.expectedIntentRevision)
      throw new AgentSessionError('SESSION_MEMORY_CONFLICT', 'Memory navigation intent changed.');
    const rollback = structuredClone(session);
    try {
      const applied = applyMemorySessionNavigation(
        session,
        input,
        state.createBranchId,
        readMemoryClock(state.clock)
      );
      if (input.binding !== undefined) {
        if (input.binding.id !== applied.affectedBranchId)
          throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory binding branch differs.');
        const bindingKey = JSON.stringify(['binding', input.binding.id]);
        session.memoryRecords.set(
          bindingKey,
          decideMemoryRecord(session.memoryRecords.get(bindingKey), {
            ...input,
            kind: 'binding',
            id: input.binding.id,
            value: input.binding.value,
            expectedRevision: null,
            settled: true,
          })
        );
      }
      session.memoryRecords.set(
        key,
        decideMemoryRecord(intent, {
          ...input,
          kind: 'navigation',
          id: input.intentId,
          expectedRevision: intent.revision,
          settled: true,
          value: JSON.stringify({ ...(JSON.parse(intent.value) as object), applied }),
        })
      );
      advanceMemoryExecution(session);
      return applied;
    } catch (cause) {
      state.sessions.set(memorySessionKey(session.agentId, session.sessionId), rollback);
      throw cause;
    }
  });
}
