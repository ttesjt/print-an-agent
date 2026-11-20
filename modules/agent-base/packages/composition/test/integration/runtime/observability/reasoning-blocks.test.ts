import { BUILT_IN_RESPONSIBILITIES } from '@print-an-agent/base-actor';
import { MemorySessionAdapter, SqliteSessionAdapter } from '@print-an-agent/base-local-adapters';
import { parseSessionId, parseTurnId } from '@print-an-agent/base-session';
import { createToolRegistry, defineTool } from '@print-an-agent/base-tool';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import {
  defaultRequestStep,
  interactionAgent,
  interactionMessage,
} from '../../../support/runtime/interaction-agent.js';

describe('Model-turn reasoning presentation boundaries', () => {
  it.each(['memory', 'sqlite'] as const)(
    'preserves both sides of a real Pi Tool loop in %s storage',
    async (kind) => {
      const directory = mkdtempSync(join(tmpdir(), 'reasoning-blocks-'));
      const databasePath = join(directory, 'agent.sqlite');
      try {
        const session =
          kind === 'memory'
            ? new MemorySessionAdapter()
            : new SqliteSessionAdapter({ databasePath });
        const api = createDeterministicAgentAPI({
          identity: { id: 'reasoning-blocks' },
          session,
          provider: {
            charactersPerChunk: 1,
            responses: [
              { status: 'tool-call', name: 'lookup', reasoning: 'before tool' },
              { status: 'success', text: 'answer', reasoning: 'after tool' },
            ],
          },
          toolRegistry: createToolRegistry([
            defineTool({
              name: 'lookup',
              description: 'Returns a fact.',
              parameters: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
              },
              execute: () => Promise.resolve({ text: 'fact' }),
            }),
          ]),
          mainActor: { allowedTools: ['lookup'] },
          responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) => ({
            ...definition,
            allowedTools: ['lookup'],
          })),
          productToolAllowList: ['lookup'],
          runtimeToolAllowList: ['lookup'],
        });
        const response = await api.run({ message: 'lookup' });
        expect(response.toolRun.records).toHaveLength(1);
        const reopened = kind === 'memory' ? session : new SqliteSessionAdapter({ databasePath });
        const record = await reopened.readTurnPresentation({
          agentId: api.identity.id,
          sessionId: response.sessionId,
          turnId: parseTurnId(response.requestId),
        });
        expect(record?.presentation.reasoningBlocks).toEqual([
          { modelTurnIndex: 1, text: 'before tool' },
          { modelTurnIndex: 2, text: 'after tool' },
        ]);
        expect(JSON.stringify(response)).not.toContain('before tool');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('keeps model ordinals across empty and filtered turns instead of renumbering display blocks', async () => {
    const capture = defaultRequestStep('captureReasoningPresentation');
    const fixture = await interactionAgent(
      async (request) => {
        for (const delta of ['first', 'filtered', '', 'fourth']) {
          await request.emit({ type: 'turn-start' });
          await request.emit({ type: 'reasoning-delta', delta });
          if (delta !== 'fourth') await request.emit({ type: 'turn-end' });
        }
        const message = interactionMessage();
        await request.emit({ type: 'assistant-complete', message });
        await request.emit({ type: 'turn-end' });
        return { message };
      },
      {
        stepOverrides: {
          captureReasoningPresentation: (context) =>
            context.state.modelTurnCount === 2 ? Promise.resolve() : capture(context),
        },
      }
    );
    await fixture.run();
    expect(
      (
        await fixture.session.readTurnPresentation({
          agentId: fixture.agent.identity.id,
          sessionId: parseSessionId('session'),
          turnId: parseTurnId('interaction-run'),
        })
      )?.presentation.reasoningBlocks
    ).toEqual([
      { modelTurnIndex: 1, text: 'first' },
      { modelTurnIndex: 4, text: 'fourth' },
    ]);
  });
});
