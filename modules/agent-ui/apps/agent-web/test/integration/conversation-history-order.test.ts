// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineActorEngine } from '@print-an-agent/model-invocation-core';
import type { ConversationInteractionEvent, ConversationTurn } from '@print-an-agent/ui-contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';
import { engineConfig } from '../support/agent-config.js';

function value<T>(
  result: { status: 'succeeded'; value: T } | { status: 'failed'; failure: unknown }
): T {
  if (result.status === 'failed') throw new Error(JSON.stringify(result.failure));
  return result.value;
}

describe('persisted conversation causal pagination', () => {
  it.each(['memory', 'directory'] as const)(
    'preserves lineage, failure placement and page cursors with regressing clocks in %s',
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), 'agent-web-history-'));
      let clock = 1_800_000_000_000;
      const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
      try {
        const offline = createOfflineWebEngine();
        const interact = offline.interact;
        if (interact === undefined) throw new Error('Expected offline interaction handler.');
        const ports = createAgentBaseWebPorts({
          engine: defineActorEngine({
            ...offline,
            interact: (request) => {
              if (request.prompt.text.startsWith('fail'))
                return Promise.reject(new Error('Test failure'));
              return interact(request);
            },
          }),
          persistence: kind === 'memory' ? { kind } : { kind, rootDirectory: root },
        });
        value(
          await ports.agents.createAgent({
            identity: { agentId: 'order', displayName: 'Order' },
            config: engineConfig(),
          })
        );
        const seed: ConversationInteractionEvent[] = [];
        await ports.conversations.streamInteraction(
          { agentId: 'order', interactionId: 'seed', message: 'First' },
          (event) => {
            seed.push(event);
            return Promise.resolve();
          }
        );
        const terminal = seed.at(-1);
        if (terminal?.type !== 'completed') throw new Error('Expected initial completion.');
        const target = { agentId: 'order', sessionId: terminal.sessionId };
        const branchId = terminal.turn.branchId;
        const messages = [
          'First',
          'fail-before-second',
          'fail-again',
          'Second',
          'fail-before-third',
          'Third',
          'fail-after-third',
        ];
        for (const message of messages.slice(1)) {
          clock -= 1000;
          const navigation = value(await ports.sessions.inspectSessionNavigation(target));
          const events: ConversationInteractionEvent[] = [];
          await ports.conversations.streamInteraction(
            {
              ...target,
              interactionId: message,
              message,
              session: {
                sessionId: target.sessionId,
                branchId,
                navigationRevision: navigation.revision,
              },
            },
            (event) => {
              events.push(event);
              return Promise.resolve();
            }
          );
          expect(events.at(-1)?.type).toBe(message.startsWith('fail') ? 'failed' : 'completed');
        }
        const history = value(await ports.conversations.readConversation({ ...target, branchId }));
        expect(history.turns.map((turn) => turn.userMessage.text)).toEqual(messages);
        let cursor: string | undefined;
        let paged: readonly ConversationTurn[] = [];
        do {
          const page = value(
            await ports.conversations.readConversation({
              ...target,
              branchId,
              limit: 2,
              ...(cursor === undefined ? {} : { cursor }),
            })
          );
          paged = [...page.turns, ...paged];
          cursor = page.nextCursor;
        } while (cursor !== undefined);
        expect(paged).toEqual(history.turns);

        const navigation = value(await ports.sessions.inspectSessionNavigation(target));
        const rewind = value(
          await ports.conversations.rewindSessionBranch({
            ...target,
            throughTurnId: terminal.turn.turnId,
            expectedRevision: navigation.revision,
          })
        );
        const rewound = value(
          await ports.conversations.readConversation({
            ...target,
            branchId: rewind.affectedBranchId,
          })
        );
        expect(rewound.turns.map((turn) => turn.userMessage.text)).toEqual(['First']);
      } finally {
        clockSpy.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
