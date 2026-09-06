import { describe, expect, it } from 'vitest';
import {
  parseModelExecutionProvenanceType,
  type AssistantModelMessage,
} from '@ta-agent/base-model';
import {
  AgentActorError,
  createActorCatalog,
  defineActor,
  defineActorEngine,
  defineActorEngineCapabilities,
  MAIN_ACTOR_ID,
  narrowActorCapabilities,
  parseActorId,
} from '../../src/index.js';
import { EMPTY_TOOL_RUNTIME, fakeEngine, type FakeEngineInspection } from '../support/fixtures.js';

function inspection(): FakeEngineInspection {
  return { interactionRequests: [], directRequests: [] };
}

function expectActorError(action: () => unknown, code: AgentActorError['code']): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining({ code }));
}

describe('Actor domain', () => {
  it('validates stable Actor identifiers', () => {
    expect(parseActorId('reviewer')).toBe('reviewer');
    expectActorError(() => parseActorId('bad actor'), 'ACTOR_ID_INVALID');
  });

  it('requires a custom Engine to declare capabilities matching its handlers', () => {
    expectActorError(
      () =>
        defineActorEngine({
          id: 'broken',
          capabilities: {
            invocationModes: ['direct'],
            inputMediaTypes: ['text'],
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
        }),
      'ACTOR_ENGINE_INVALID'
    );
  });

  it('rejects unknown capability fields and duplicate values', () => {
    expectActorError(
      () =>
        defineActorEngineCapabilities({
          invocationModes: ['direct', 'direct'],
          inputMediaTypes: ['text'],
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        }),
      'ACTOR_CAPABILITIES_INVALID'
    );
  });

  it('binds streamability declarations exactly to interaction invocation', () => {
    const common = {
      inputMediaTypes: ['text'] as const,
      toolCalling: false,
      structuredOutput: false,
      cancellation: true,
    };
    expectActorError(
      () =>
        defineActorEngineCapabilities({
          ...common,
          invocationModes: ['interaction'],
        }),
      'ACTOR_CAPABILITIES_INVALID'
    );
    expectActorError(
      () =>
        defineActorEngineCapabilities({
          ...common,
          invocationModes: ['direct'],
          interaction: { streamable: true },
        }),
      'ACTOR_CAPABILITIES_INVALID'
    );
    expectActorError(
      () =>
        defineActorEngineCapabilities({
          ...common,
          invocationModes: ['interaction'],
          interaction: { streamable: true, streaming: true } as never,
        }),
      'ACTOR_CAPABILITIES_INVALID'
    );
  });

  it('allows Actor capability narrowing without widening Engine authority', () => {
    const engine = defineActorEngineCapabilities({
      invocationModes: ['interaction', 'direct'],
      inputMediaTypes: ['text', 'image'],
      interaction: { streamable: true },
      toolCalling: true,
      structuredOutput: false,
      cancellation: true,
      maxContextTokens: 8_192,
    });
    const narrowedInteraction = narrowActorCapabilities(engine, {
      interaction: { streamable: false },
      inputMediaTypes: ['text'],
      toolCalling: false,
      maxContextTokens: 4_096,
    });
    expect(narrowedInteraction).toMatchObject({
      invocationModes: ['interaction', 'direct'],
      inputMediaTypes: ['text'],
      interaction: { streamable: false },
      toolCalling: false,
      maxContextTokens: 4_096,
    });
    expect(Object.isFrozen(narrowedInteraction.interaction)).toBe(true);
    const directOnly = narrowActorCapabilities(engine, {
      invocationModes: ['direct'],
      inputMediaTypes: ['text'],
      toolCalling: false,
      maxContextTokens: 4_096,
    });
    expect(directOnly).toMatchObject({
      invocationModes: ['direct'],
      inputMediaTypes: ['text'],
      toolCalling: false,
      maxContextTokens: 4_096,
    });
    expect(directOnly).not.toHaveProperty('interaction');
    expectActorError(
      () => narrowActorCapabilities(engine, { structuredOutput: true }),
      'ACTOR_CAPABILITY_WIDENING'
    );
    expectActorError(
      () => narrowActorCapabilities(engine, { maxContextTokens: 16_384 }),
      'ACTOR_CAPABILITY_WIDENING'
    );
    const nonStreamable = defineActorEngineCapabilities({
      invocationModes: ['interaction'],
      inputMediaTypes: ['text'],
      interaction: { streamable: false },
      toolCalling: false,
      structuredOutput: false,
      cancellation: true,
    });
    expectActorError(
      () => narrowActorCapabilities(nonStreamable, { interaction: { streamable: true } }),
      'ACTOR_CAPABILITY_WIDENING'
    );
  });

  it('keeps optional Actor extensions empty and Tool permission denied by omission', () => {
    expect(defineActor({ id: 'minimal', engineId: 'engine' })).toEqual({
      id: 'minimal',
      engineId: 'engine',
      invocationConfig: {},
      allowedTools: [],
    });
  });

  it('rejects unknown invocation config and normalizes Actor-owned Tool errors', () => {
    expectActorError(
      () =>
        defineActor({
          id: 'invalid-config',
          engineId: 'engine',
          invocationConfig: { temperature: 0.2, seed: 1 } as never,
        }),
      'ACTOR_DEFINITION_INVALID'
    );
    expectActorError(
      () =>
        defineActor({
          id: 'invalid-tool',
          engineId: 'engine',
          allowedTools: ['bad tool'],
        }),
      'ACTOR_DEFINITION_INVALID'
    );
  });

  it('rejects duplicate catalog identity and missing Engine bindings', () => {
    const engine = fakeEngine('engine', inspection());
    expectActorError(
      () =>
        createActorCatalog({
          actors: [
            { id: 'main', engineId: 'engine' },
            { id: 'main', engineId: 'engine' },
          ],
          engines: [engine],
        }),
      'ACTOR_CATALOG_INVALID'
    );
    expectActorError(
      () =>
        createActorCatalog({
          actors: [{ id: 'main', engineId: 'missing' }],
          engines: [engine],
        }),
      'ACTOR_ENGINE_NOT_FOUND'
    );
  });

  it('returns immutable detached definitions and resolved revisions', async () => {
    const catalog = createActorCatalog({
      revision: 7,
      actors: [{ id: 'main', engineId: 'engine', allowedTools: ['search'] }],
      engines: [fakeEngine('engine', inspection())],
    });
    const listed = catalog.list();
    const actor = await catalog.resolve(MAIN_ACTOR_ID);
    expect(actor.catalogRevision).toBe(7);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0]?.allowedTools)).toBe(true);
    expect(Object.isFrozen(actor.capabilities)).toBe(true);
  });

  it('normalizes mutable Engine terminal events and results at the resolved Actor boundary', async () => {
    const mutableEvidence = { target: { id: 'target-1' } };
    const mutableUsage = {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    };
    const message: AssistantModelMessage = {
      role: 'assistant',
      text: 'completed',
      provenance: {
        kind: 'engine-defined',
        type: parseModelExecutionProvenanceType('test.target'),
        evidence: mutableEvidence,
      },
      stopReason: 'stop',
      usage: mutableUsage,
      timestamp: 1,
    };
    const catalog = createActorCatalog({
      actors: [{ id: MAIN_ACTOR_ID, engineId: 'engine' }],
      engines: [
        {
          id: 'engine',
          capabilities: {
            invocationModes: ['interaction'],
            inputMediaTypes: ['text'],
            interaction: { streamable: true },
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          interact: async (request) => {
            await request.emit({ type: 'assistant-complete', message });
            return { message };
          },
        },
      ],
    });
    const actor = await catalog.resolve(MAIN_ACTOR_ID);
    let emitted: AssistantModelMessage | undefined;
    const result = await actor.interact({
      instructions: '',
      history: [],
      prompt: { role: 'user', text: 'hello', timestamp: 1 },
      tools: EMPTY_TOOL_RUNTIME,
      maxModelTurns: 1,
      maxOutputCharacters: 100,
      signal: new AbortController().signal,
      emit: (event) => {
        if (event.type === 'assistant-complete') emitted = event.message;
        return Promise.resolve();
      },
    });
    mutableEvidence.target.id = 'mutated';
    mutableUsage.totalTokens = 99;

    for (const normalized of [emitted, result.message]) {
      expect(normalized?.provenance).toMatchObject({
        kind: 'engine-defined',
        evidence: { target: { id: 'target-1' } },
      });
      expect(normalized?.usage.totalTokens).toBe(2);
      expect(Object.isFrozen(normalized)).toBe(true);
      expect(Object.isFrozen(normalized?.provenance)).toBe(true);
    }
  });

  it('fails an unsupported invocation before calling the Engine handler', async () => {
    const calls = inspection();
    const directOnly = fakeEngine('engine', calls);
    const catalog = createActorCatalog({
      actors: [
        {
          id: 'main',
          engineId: 'engine',
          capabilityLimits: { invocationModes: ['direct'] },
        },
      ],
      engines: [directOnly],
    });
    const actor = await catalog.resolve(MAIN_ACTOR_ID);
    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'hello', timestamp: 1 },
        tools: {
          tools: [],
          execute: () => Promise.resolve({ status: 'success', text: '' }),
          close: () => undefined,
          inspect: () => ({
            status: 'open',
            effectiveTools: [],
            records: [],
            totalResultCharacters: 0,
          }),
        },
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toMatchObject({ code: 'ACTOR_INVOCATION_UNSUPPORTED' });
    expect(calls.interactionRequests).toHaveLength(0);
  });
});
