import { describe, expect, it } from 'vitest';
import {
  defineActorEngine,
  defineActorEngineCapabilities,
  defineActorInvocationPolicy,
  narrowActorCapabilities,
  parseActorId,
  type ActorError,
} from '../../../src/index.js';
function expectActorError(action: () => unknown, code: ActorError['code']): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining({ code }));
}
describe('Actor definitions and capabilities', () => {
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
      maxContextTokens: 8192,
    });
    const narrowedInteraction = narrowActorCapabilities(engine, {
      interaction: { streamable: false },
      inputMediaTypes: ['text'],
      toolCalling: false,
      maxContextTokens: 4096,
    });
    expect(narrowedInteraction).toMatchObject({
      invocationModes: ['interaction', 'direct'],
      inputMediaTypes: ['text'],
      interaction: { streamable: false },
      toolCalling: false,
      maxContextTokens: 4096,
    });
    expect(Object.isFrozen(narrowedInteraction.interaction)).toBe(true);
    const directOnly = narrowActorCapabilities(engine, {
      invocationModes: ['direct'],
      inputMediaTypes: ['text'],
      toolCalling: false,
      maxContextTokens: 4096,
    });
    expect(directOnly).toMatchObject({
      invocationModes: ['direct'],
      inputMediaTypes: ['text'],
      toolCalling: false,
      maxContextTokens: 4096,
    });
    expect(directOnly).not.toHaveProperty('interaction');
    expectActorError(
      () => narrowActorCapabilities(engine, { structuredOutput: true }),
      'ACTOR_CAPABILITY_WIDENING'
    );
    expectActorError(
      () => narrowActorCapabilities(engine, { maxContextTokens: 16384 }),
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

  it('defines a strict immutable Actor invocation policy with no default deadline', () => {
    expect(defineActorInvocationPolicy(undefined)).toEqual({ timeoutMilliseconds: null });
    expect(defineActorInvocationPolicy({ timeoutMilliseconds: null })).toEqual({
      timeoutMilliseconds: null,
    });
    const policy = defineActorInvocationPolicy({ timeoutMilliseconds: 45000 });
    expect(policy).toEqual({ timeoutMilliseconds: 45000 });
    expect(Object.isFrozen(policy)).toBe(true);
    for (const timeoutMilliseconds of [0, -1, 1.5, 2147483648]) {
      expectActorError(
        () => defineActorInvocationPolicy({ timeoutMilliseconds }),
        'ACTOR_DEFINITION_INVALID'
      );
    }
    expectActorError(
      () => defineActorInvocationPolicy({ timeoutMilliseconds: 1, extra: true } as never),
      'ACTOR_DEFINITION_INVALID'
    );
    expectActorError(() => defineActorInvocationPolicy({} as never), 'ACTOR_DEFINITION_INVALID');
    expectActorError(
      () =>
        defineActorInvocationPolicy(
          Object.defineProperty({}, 'timeoutMilliseconds', {
            enumerable: true,
            get: () => 1,
          }) as never
        ),
      'ACTOR_DEFINITION_INVALID'
    );
  });
});
