import type { AgentLoopEvent } from '@ta-agent/base-model';
import {
  createBoundedToolRuntime,
  createToolRegistry,
  defineTool,
  defineToolPermissionPolicy,
  DEFAULT_TOOL_EXECUTION_POLICY,
} from '@ta-agent/base-tool';
import { describe, expect, it } from 'vitest';
import { createPiFauxRuntime, createPiProviderRuntime } from '../../src/index.js';
import { createOpenAICompatibleTestServer } from '../support/openai-compatible-server.js';

function tools(signal: AbortSignal, enabled: boolean) {
  const names = enabled ? ['lookup'] : [];
  return createBoundedToolRuntime({
    registry: createToolRegistry(
      enabled
        ? [
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
          ]
        : []
    ),
    permissionPolicy: defineToolPermissionPolicy({
      responsibility: names,
      actor: names,
      product: names,
      runtime: names,
    }),
    executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
    signal,
  });
}

describe('Pi reasoning events', () => {
  it('streams reasoning during Tool turns without publishing their intermediate answer text', async () => {
    const profile = createPiFauxRuntime({
      responses: [
        { status: 'tool-call', name: 'lookup', text: 'discarded text', reasoning: 'before tool' },
        { status: 'success', text: 'answer', reasoning: 'after tool' },
      ],
      charactersPerChunk: 100,
    });
    const signal = new AbortController().signal;
    const runtime = tools(signal, true);
    const events: AgentLoopEvent[] = [];
    try {
      const result = await profile.runtime.run({
        target: await profile.runtime.resolveTarget(profile.modelReference),
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'lookup', timestamp: 1 },
        tools: runtime,
        maxModelTurns: 2,
        maxOutputCharacters: 100,
        signal,
        emit: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      });
      expect(result.message.text).toBe('answer');
      expect(
        events.filter((event) => event.type === 'reasoning-delta' || event.type === 'text-delta')
      ).toEqual([
        { type: 'reasoning-delta', delta: 'before tool' },
        { type: 'reasoning-delta', delta: 'after tool' },
        { type: 'text-delta', delta: 'answer' },
      ]);
      expect(events.findIndex((event) => event.type === 'reasoning-delta')).toBeLessThan(
        events.findIndex((event) => event.type === 'tool-call-start')
      );
      expect(JSON.stringify(result)).not.toContain('before tool');
      expect(profile.inspect().callCount).toBe(2);
    } finally {
      runtime.close();
    }
  });

  it.each([
    {
      supportsReasoning: true,
      supportsDeveloperRole: false,
      instructionRole: 'system',
      reasoning: 'readable summary',
    },
    {
      supportsReasoning: true,
      supportsDeveloperRole: true,
      instructionRole: 'developer',
      reasoning: 'readable summary',
    },
    {
      supportsReasoning: false,
      supportsDeveloperRole: false,
      instructionRole: 'system',
      reasoning: undefined,
    },
    {
      supportsReasoning: false,
      supportsDeveloperRole: true,
      instructionRole: 'system',
      reasoning: undefined,
    },
  ] as const)(
    'uses $instructionRole instructions when reasoning=$supportsReasoning and developer-role=$supportsDeveloperRole',
    async ({ supportsReasoning, supportsDeveloperRole, instructionRole, reasoning }) => {
      const server = await createOpenAICompatibleTestServer('answer', reasoning);
      const signal = new AbortController().signal;
      const runtime = tools(signal, false);
      const events: AgentLoopEvent[] = [];
      try {
        const profile = createPiProviderRuntime({
          provider: {
            kind: 'openai-compatible',
            reference: { provider: 'local', model: 'test-model', baseUrl: server.baseUrl },
            contextWindowTokens: 4096,
            maxOutputTokens: 512,
            supportsReasoning,
            compatibility: { supportsDeveloperRole },
          },
        });
        const result = await profile.actorEngine.interact?.({
          instructions: 'Answer directly.',
          history: [],
          prompt: { role: 'user', text: 'hello', timestamp: 1 },
          tools: runtime,
          maxModelTurns: 1,
          maxOutputCharacters: 100,
          signal,
          invocationConfig: {},
          emit: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        });
        expect(events.filter((event) => event.type === 'reasoning-delta')).toEqual(
          reasoning === undefined ? [] : [{ type: 'reasoning-delta', delta: reasoning }]
        );
        expect(result?.message.text).toBe('answer');
        expect(JSON.stringify(result)).not.toContain('readable summary');
        expect(profile.inspect().supportsReasoning).toBe(supportsReasoning);
        expect(profile.inspect()).toMatchObject({
          compatibility: { supportsDeveloperRole },
        });
        const requestBody = server.requests()[0]?.body as
          | Readonly<{ messages?: readonly unknown[] }>
          | undefined;
        expect(requestBody?.messages?.[0]).toMatchObject({
          role: instructionRole,
          content: 'Answer directly.',
        });
        expect(requestBody).not.toHaveProperty('reasoning_effort');
      } finally {
        runtime.close();
        await server.close();
      }
    }
  );
});
