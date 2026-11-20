import type { RequestMemoryRun, RequestMemoryTarget } from '@print-an-agent/base-request';
import { AgentSessionError, type SessionMemoryRecord } from '@print-an-agent/base-session';
import { SessionMemoryCommitError } from './errors.js';
import { MemoryJournal, memoryString, payload, version } from './journal.js';
import { applyRuntimeMemory } from './mutations/index.js';
import { createContextMemoryTools } from './tools.js';
import type { SessionContextMemoryOptions } from './types/options.js';

export async function openSessionMemoryTurn(
  options: SessionContextMemoryOptions,
  authorityId: string,
  target: RequestMemoryTarget,
  signal: AbortSignal,
  journal: MemoryJournal,
  binding: SessionMemoryRecord
): Promise<RequestMemoryRun> {
  const memoryId = memoryString(payload(binding).memoryId);
  const snapshot = await options.memory.inspect.run({ input: { memoryId }, signal });
  if (snapshot === undefined || snapshot.memoryId !== memoryId)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory inspection was skipped.');
  const input = { memoryId, revision: snapshot.revision };
  const rendered = await options.memory.readVersionContext.run({ input, signal });
  if (
    rendered === undefined ||
    rendered.snapshot.memoryId !== memoryId ||
    rendered.snapshot.revision !== input.revision
  )
    throw new AgentSessionError(
      'SESSION_MEMORY_INVALID',
      'Memory rendering did not match the pinned version.'
    );
  await journal.put(
    'turn',
    target.turn.turnId,
    { branchId: target.session.branchId, input, final: input },
    false
  );
  let writeFailure: SessionMemoryCommitError | undefined;
  return {
    inputVersion: input,
    text: JSON.stringify({ type: 'session-context-memory', version: input, data: rendered.text }),
    tools: (options.createTools ?? createContextMemoryTools)({
      writable: options.writable === true,
      read: async (toolSignal) => {
        const current = await options.memory.inspect.run({
          input: { memoryId },
          signal: toolSignal,
        });
        if (current === undefined || current.memoryId !== memoryId)
          throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory read was skipped.');
        const checkpoint = await journal.read('turn', target.turn.turnId);
        if (checkpoint === undefined)
          throw new AgentSessionError(
            'SESSION_MEMORY_PENDING',
            'Turn Memory checkpoint is missing.'
          );
        const state = payload(checkpoint);
        const previous = version(state.final);
        if (previous.memoryId !== memoryId)
          throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Read Memory authority differs.');
        if (current.revision > previous.revision)
          await journal.put(
            'turn',
            checkpoint.id,
            { ...state, final: { memoryId, revision: current.revision } },
            false,
            checkpoint
          );
        return JSON.stringify({
          version: { memoryId, revision: current.revision },
          items: current.items,
        });
      },
      apply: async (expectedRevision, commands, callId, toolSignal) => {
        if (options.writable !== true)
          throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory is read-only.');
        try {
          return await applyRuntimeMemory({
            journal,
            memory: options.memory,
            authorityId: authorityId,
            turnId: target.turn.turnId,
            branchId: target.session.branchId,
            input: {
              memoryId,
              requestId: JSON.stringify(['tool', target.requestId, callId]),
              expectedRevision,
              commands,
            },
            signal: toolSignal,
          });
        } catch (cause) {
          if (cause instanceof SessionMemoryCommitError) writeFailure = cause;
          throw cause;
        }
      },
    }),
    settle: async () => {
      const outstanding = await options.session.listPendingMemoryRecords(target.session);
      if (outstanding.some((record) => record.kind === 'mutation')) {
        if (writeFailure !== undefined) throw writeFailure;
        throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Memory tool outcome is unresolved.');
      }
      const row = await journal.read('turn', target.turn.turnId);
      if (row === undefined)
        throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Turn Memory checkpoint is missing.');
      if (!row.settled) await journal.put('turn', row.id, payload(row), true, row);
    },
  };
}
