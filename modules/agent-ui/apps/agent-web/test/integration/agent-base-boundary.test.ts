// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineActorEngine } from '@ta-agent/base-actor';
import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { createOfflineWebEngine } from '../../src/node/offline-engine.js';

function value<T>(
  result: { status: 'succeeded'; value: T } | { status: 'failed'; failure: unknown }
): T {
  if (result.status === 'failed') throw new Error(JSON.stringify(result.failure));
  return result.value;
}
const config = { instructions: 'Be helpful.', responseStyle: 'balanced' as const };

describe('Agent Base public boundary qualification', () => {
  it.each(['memory', 'directory'] as const)(
    'qualifies authority, stream, history, branching and lifecycle with %s persistence',
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), 'agent-web-qualification-'));
      const options = {
        engine: createOfflineWebEngine(),
        persistence: kind === 'memory' ? { kind } : { kind, rootDirectory: root },
      };
      try {
        let ports = createAgentBaseWebPorts(options);
        const created = value(
          await ports.agents.createAgent({
            identity: { agentId: 'qualified', displayName: 'Qualified' },
            config,
          })
        );
        expect(created.details).toEqual(
          expect.objectContaining(value(await ports.agents.listAgents())[0])
        );
        const updated = value(
          await ports.agents.updateAgentConfig({
            agentId: 'qualified',
            expectedRevision: created.config.revision,
            config: { ...config, instructions: 'Updated.' },
          })
        );
        expect(
          (
            await ports.agents.updateAgentConfig({
              agentId: 'qualified',
              expectedRevision: created.config.revision,
              config,
            })
          ).status
        ).toBe('failed');
        const events: ConversationInteractionEvent[] = [];
        await ports.conversations.streamInteraction(
          { agentId: 'qualified', interactionId: 'initial', message: 'Hello' },
          (event) => {
            events.push(event);
            return Promise.resolve();
          }
        );
        const terminal = events.at(-1);
        expect(terminal?.type).toBe('completed');
        if (terminal?.type !== 'completed') throw new Error(JSON.stringify(terminal));
        expect(events.some((event) => event.type === 'reasoning-delta')).toBe(true);
        const target = { agentId: 'qualified', sessionId: terminal.sessionId };
        const nav = value(await ports.sessions.inspectSessionNavigation(target));
        const history = value(
          await ports.conversations.readConversation({ ...target, branchId: nav.selectedBranchId })
        );
        expect(history.turns[0]).toEqual(terminal.turn);
        const fork = value(
          await ports.conversations.forkSessionBranch({
            ...target,
            sourceBranchId: nav.selectedBranchId,
            throughTurnId: terminal.turn.turnId,
            expectedRevision: nav.revision,
            newBranchId: 'fork',
          })
        );
        expect(
          value(
            await ports.conversations.readConversation({
              ...target,
              branchId: fork.affectedBranchId,
            })
          ).turns[0]?.branchId
        ).toBe('fork');
        const details = value(await ports.sessions.inspectSession(target));
        const renamed = value(
          await ports.sessions.renameSession({
            ...target,
            title: 'Named',
            expectedRevision: details.metadataRevision,
          })
        );
        expect(renamed.title).toBe('Named');
        const retired = value(
          await ports.sessions.retireSession({
            ...target,
            expectedRevision: renamed.metadataRevision,
          })
        );
        expect(
          value(await ports.sessions.listSessions({ agentId: 'qualified', status: 'retired' }))
            .records[0]?.title
        ).toBe('Named');
        const restored = value(
          await ports.sessions.restoreSession({
            ...target,
            expectedRevision: retired.metadataRevision,
          })
        );
        expect(restored.status).toBe('active');
        if (kind === 'directory') ports = createAgentBaseWebPorts(options);
        expect(value(await ports.agents.readAgentConfig({ agentId: 'qualified' })).revision).toBe(
          updated.revision
        );
        expect(
          value(await ports.conversations.readConversation({ ...target, branchId: 'fork' })).turns
        ).toHaveLength(1);
        const disabled = value(
          await ports.agents.disableAgent({
            agentId: 'qualified',
            expectedRevision: created.details.identityRevision,
          })
        );
        expect(disabled.status).toBe('disabled');
        expect(
          value(
            await ports.agents.reactivateAgent({
              agentId: 'qualified',
              expectedRevision: disabled.identityRevision,
            })
          ).status
        ).toBe('active');
        value(
          await ports.sessions.retireSession({
            ...target,
            expectedRevision: restored.metadataRevision,
          })
        );
        const purgeable = value(await ports.sessions.inspectSession(target));
        value(
          await ports.sessions.purgeSession({
            ...target,
            expectedRevision: purgeable.metadataRevision,
            confirmation: 'permanently-delete-session',
          })
        );
        expect((await ports.sessions.inspectSession(target)).status).toBe('failed');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('preserves model-turn reasoning boundaries, safe tools and cancellation without raw payloads', async () => {
    const base = createOfflineWebEngine();
    const engine = defineActorEngine({
      ...base,
      id: 'qualification.multi',
      capabilities: { ...base.capabilities, toolCalling: true },
      interact: async (request) => {
        await request.emit({ type: 'turn-start' });
        await request.emit({ type: 'reasoning-delta', delta: 'Before tool' });
        await request.emit({
          type: 'tool-call-start',
          callId: 'c1',
          toolName: 'private-tool-name',
        });
        await request.emit({
          type: 'tool-call-end',
          callId: 'c1',
          toolName: 'private-tool-name',
          status: 'success',
          resultCharacters: 25,
        });
        await request.emit({ type: 'turn-end' });
        if (base.interact === undefined) throw new Error('Missing fixture handler');
        return base.interact(request);
      },
    });
    const ports = createAgentBaseWebPorts({ engine, persistence: { kind: 'memory' } });
    value(
      await ports.agents.createAgent({
        identity: { agentId: 'multi', displayName: 'Multi' },
        config,
      })
    );
    const events: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'multi', interactionId: 'multi', message: 'Question' },
      (event) => {
        events.push(event);
        return Promise.resolve();
      }
    );
    const terminal = events.at(-1);
    if (terminal?.type !== 'completed') throw new Error(JSON.stringify(terminal));
    expect(
      terminal.turn.assistantMessage.reasoningBlocks.map((block) => block.modelTurnIndex)
    ).toEqual([1, 2]);
    expect(terminal.turn.assistantMessage.toolActivities[0]?.toolLabel).toBe('Tool');
    expect(JSON.stringify(events)).not.toContain('private-tool-name');
    const controller = new AbortController();
    const cancelled: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      { agentId: 'multi', interactionId: 'cancel', message: 'Cancel', signal: controller.signal },
      (event) => {
        cancelled.push(event);
        if (event.type === 'reasoning-delta') controller.abort();
        return Promise.resolve();
      }
    );
    expect(cancelled.at(-1)?.type).toBe('cancelled');
    const nav = value(
      await ports.sessions.inspectSessionNavigation({
        agentId: 'multi',
        sessionId: terminal.sessionId,
      })
    );
    const stale: ConversationInteractionEvent[] = [];
    await ports.conversations.streamInteraction(
      {
        agentId: 'multi',
        interactionId: 'stale',
        message: 'Reject',
        session: {
          sessionId: terminal.sessionId,
          branchId: nav.selectedBranchId,
          navigationRevision: '999',
        },
      },
      (event) => {
        stale.push(event);
        return Promise.resolve();
      }
    );
    expect(stale.at(-1)?.type).toBe('failed');
  });
});
