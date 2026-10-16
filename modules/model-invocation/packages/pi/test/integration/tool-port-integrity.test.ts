import { expect, it } from 'vitest';
import {
  createActor,
  requireInteractionCapability,
  type ActorInteractionRequest,
  type InteractionTools,
  type ToolCallProposal,
  type ToolExecutionOutcome,
  type ToolObjectSchema,
} from '@ta-agent/model-invocation-core';
import { createPiProviderRuntime } from '../../src/index.js';
import { completionServer } from '../support/completion-server.js';

function providerActor(baseUrl: string) {
  const profile = createPiProviderRuntime({
    provider: {
      kind: 'openai-compatible',
      reference: { provider: 'fixture', model: 'fixture', baseUrl },
      contextWindowTokens: 4096,
      maxOutputTokens: 256,
      supportsReasoning: false,
      compatibility: { supportsDeveloperRole: false },
    },
  });
  return requireInteractionCapability(createActor({ id: 'worker', engine: profile.actorEngine }));
}

function request(tools: InteractionTools): ActorInteractionRequest {
  return {
    instructions: 'Use the tools.',
    history: [],
    prompt: { role: 'user', text: 'Work.', timestamp: 1 },
    tools,
    maxModelTurns: 2,
    maxOutputCharacters: 100,
    signal: new AbortController().signal,
    emit: () => Promise.resolve(),
  };
}

const EMPTY_PARAMETERS = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const satisfies ToolObjectSchema;

it.each([
  { label: 'first tool', failureIndex: 0, failure: new Error('first port failed') },
  { label: 'second tool', failureIndex: 1, failure: new Error('second port failed') },
  { label: 'non-Error rejection', failureIndex: 0, failure: undefined },
])('stops subsequent tool ports after $label rejects in the same Pi batch', async (scenario) => {
  const calls = ['first', 'second', 'third'].map((name) => ({ id: name, name, arguments: {} }));
  const server = await completionServer({ toolCalls: calls });
  try {
    const executed: string[] = [];
    const actor = providerActor(server.baseUrl);
    await expect(
      actor.interact(
        request({
          tools: calls.map((call) => ({
            name: call.name,
            description: call.name,
            parameters: EMPTY_PARAMETERS,
          })),
          execute: (proposal) => {
            executed.push(proposal.callId);
            if (executed.length === scenario.failureIndex + 1) {
              const rejection = Promise.withResolvers<ToolExecutionOutcome>();
              rejection.reject(scenario.failure);
              return rejection.promise;
            }
            return Promise.resolve({ status: 'success', text: 'done' });
          },
        })
      )
    ).rejects.toBe(scenario.failure);
    expect(executed).toEqual(calls.slice(0, scenario.failureIndex + 1).map((call) => call.id));
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});

it('keeps a handler-error recoverable and executes the remaining tool before the next model turn', async () => {
  const server = await completionServer({
    toolCalls: [
      { id: 'first', name: 'work', arguments: {} },
      { id: 'second', name: 'work', arguments: {} },
    ],
  });
  try {
    const executed: string[] = [];
    const result = await providerActor(server.baseUrl).interact(
      request({
        tools: [{ name: 'work', description: 'Work', parameters: EMPTY_PARAMETERS }],
        execute: (proposal) => {
          executed.push(proposal.callId);
          return Promise.resolve(
            proposal.callId === 'first'
              ? { status: 'handler-error', text: 'try another operation' }
              : { status: 'success', text: 'recovered' }
          );
        },
      })
    );
    expect(executed).toEqual(['first', 'second']);
    expect(result.message.text).toBe('proposed update');
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]).toHaveProperty(
      'messages',
      expect.arrayContaining([
        { role: 'tool', tool_call_id: 'first', content: 'try another operation' },
        { role: 'tool', tool_call_id: 'second', content: 'recovered' },
      ])
    );
  } finally {
    await server.close();
  }
});

const OPTIONAL_PARAMETERS = {
  type: 'object',
  properties: { optional: { type: 'string' } },
  required: [],
  additionalProperties: false,
} as const satisfies ToolObjectSchema;

const MIXED_PARAMETERS = {
  ...OPTIONAL_PARAMETERS,
  properties: { ...OPTIONAL_PARAMETERS.properties, required: { type: 'string' } },
  required: ['required'],
} as const satisfies ToolObjectSchema;

const NESTED_PARAMETERS = {
  ...EMPTY_PARAMETERS,
  properties: { items: { type: 'array', items: MIXED_PARAMETERS } },
  required: ['items'],
} as const satisfies ToolObjectSchema;

it.each([
  { label: 'all optional omitted', parameters: OPTIONAL_PARAMETERS, arguments: {}, valid: true },
  {
    label: 'optional supplied',
    parameters: OPTIONAL_PARAMETERS,
    arguments: { optional: 'present' },
    valid: true,
  },
  {
    label: 'mixed required and optional',
    parameters: MIXED_PARAMETERS,
    arguments: { required: 'present' },
    valid: true,
  },
  {
    label: 'nested optional omitted',
    parameters: NESTED_PARAMETERS,
    arguments: { items: [{ required: 'present' }] },
    valid: true,
  },
  { label: 'missing required', parameters: MIXED_PARAMETERS, arguments: {}, valid: false },
  {
    label: 'invalid optional value',
    parameters: OPTIONAL_PARAMETERS,
    arguments: { optional: {} },
    valid: false,
  },
  {
    label: 'additional property',
    parameters: OPTIONAL_PARAMETERS,
    arguments: { undeclared: 'value' },
    valid: false,
  },
  {
    label: 'nested missing required',
    parameters: NESTED_PARAMETERS,
    arguments: { items: [{}] },
    valid: false,
  },
])('preserves tool schema semantics: $label', async (scenario) => {
  const server = await completionServer({
    toolCalls: [{ id: 'work-1', name: 'work', arguments: scenario.arguments }],
  });
  try {
    const executed: ToolCallProposal[] = [];
    const interaction = providerActor(server.baseUrl).interact(
      request({
        tools: [{ name: 'work', description: 'Work', parameters: scenario.parameters }],
        execute: (proposal) => {
          executed.push(proposal);
          return Promise.resolve({ status: 'success', text: 'done' });
        },
      })
    );
    if (scenario.valid) {
      await expect(interaction).resolves.toMatchObject({ message: { text: 'proposed update' } });
      expect(executed).toEqual([
        { callId: 'work-1', toolName: 'work', arguments: scenario.arguments },
      ]);
      expect(server.requests).toHaveLength(2);
    } else {
      await expect(interaction).rejects.toMatchObject({ code: 'TOOL_ARGUMENTS_INVALID' });
      expect(executed).toEqual([]);
      expect(server.requests).toHaveLength(1);
    }
  } finally {
    await server.close();
  }
});
