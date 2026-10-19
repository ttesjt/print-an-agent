import { expect, it } from 'vitest';
import { createActor } from '@ta-agent/model-invocation-core';
import {
  createSessionlessRequestWorkflow,
  buildRequestTools,
  type OutputStreamEvent,
} from '@ta-agent/base-request';
import {
  createToolRegistry,
  defineTool,
  defineToolPermissionPolicy,
  AgentToolError,
} from '@ta-agent/base-tool';
import { createProviderRuntime } from '../../src/index.js';
import { scriptedProviderServer } from '../support/scripted-provider-server.js';

function ordinaryActor(baseUrl: string) {
  return createActor({
    id: 'tool-caller',
    engine: createProviderRuntime({
      config: {
        kind: 'openai-compatible',
        reference: { provider: 'fixture', model: 'fixture', baseUrl },
        contextWindowTokens: 4096,
        maxOutputTokens: 256,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false },
      },
    }).actorEngine,
  });
}

const toolPermission = defineToolPermissionPolicy({
  responsibility: ['lookup'],
  actor: ['lookup'],
  product: ['lookup'],
  runtime: ['lookup'],
});
function toolRegistry(handlerFails = false) {
  return createToolRegistry([
    defineTool({
      name: 'lookup',
      description: 'Lookup',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      execute: () =>
        handlerFails ? Promise.reject(new Error('handler')) : Promise.resolve({ text: 'facts' }),
    }),
  ]);
}

const toolTurn = {
  deltas: [
    { role: 'assistant', reasoning_content: 'before tool' },
    {
      tool_calls: [
        { index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
      ],
    },
  ],
  finishReason: 'tool_calls' as const,
};
const finalTurn = {
  deltas: [{ role: 'assistant', reasoning_content: 'after tool' }, { content: 'answer' }],
  finishReason: 'stop' as const,
};

it.each(['direct', 'stream'] as const)(
  'runs Sessionless %s through one real Pi provider request',
  async (mode) => {
    const server = await scriptedProviderServer([
      {
        deltas: [
          { role: 'assistant', reasoning_content: 'consider' },
          { content: 'website answer' },
        ],
        finishReason: 'stop',
      },
    ]);
    try {
      const runtime = createProviderRuntime({
        config: {
          kind: 'openai-compatible',
          reference: { provider: 'fixture', model: 'fixture', baseUrl: server.baseUrl },
          contextWindowTokens: 4096,
          maxOutputTokens: 256,
          supportsReasoning: true,
          compatibility: { supportsDeveloperRole: false },
        },
      });

      const events: OutputStreamEvent[] = [];
      const lifecycle: string[] = [];
      const workflow = createSessionlessRequestWorkflow({
        mode,
        resources: {
          actor: createActor({ id: 'website', engine: runtime.actorEngine }),
          createOutputSink: () => ({
            open: () => {
              lifecycle.push('open');
              return Promise.resolve();
            },
            write: (event) => {
              events.push(event);
              return Promise.resolve();
            },
            close: () => {
              lifecycle.push('close');
              return Promise.resolve();
            },
            fail: () => {
              lifecycle.push('fail');
              return Promise.resolve();
            },
          }),
        },
      });
      const result = await workflow.run({ input: { message: 'Where should I start?' } });
      expect(result?.message.text).toBe('website answer');
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).not.toHaveProperty('tools');
      expect(lifecycle).toEqual(['open', 'close']);
      expect(events).toEqual(
        mode === 'direct'
          ? []
          : [
              { type: 'reasoning-delta', delta: 'consider' },
              { type: 'text-delta', delta: 'website answer' },
            ]
      );
    } finally {
      await server.close();
    }
  }
);

it.each([false, true])(
  'runs a real two-turn Sessionless Pi tool loop (handler failure: %s)',
  async (handlerFails) => {
    const server = await scriptedProviderServer([toolTurn, finalTurn]);
    try {
      const events: OutputStreamEvent[] = [];
      const workflow = createSessionlessRequestWorkflow({
        mode: 'interaction',
        resources: {
          actor: ordinaryActor(server.baseUrl),
          tools: { registry: toolRegistry(handlerFails), permissionPolicy: toolPermission },
          createOutputSink: () => ({
            open: () => Promise.resolve(),
            write: (event) => {
              events.push(event);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
            fail: () => Promise.resolve(),
          }),
        },
      });
      const result = await workflow.run({ input: { message: 'Find facts.' } });
      expect(result).toMatchObject({
        message: { text: 'answer' },
        toolRun: {
          status: 'closed',
          records: [{ callId: 'call-1', status: handlerFails ? 'handler-error' : 'success' }],
        },
      });
      expect(server.requests).toHaveLength(2);
      expect(server.requests[1]).toHaveProperty(
        'messages',
        expect.arrayContaining([expect.objectContaining({ role: 'tool' })])
      );
      expect(events).toEqual([
        { type: 'reasoning-delta', delta: 'before tool' },
        { type: 'reasoning-delta', delta: 'after tool' },
        { type: 'text-delta', delta: 'answer' },
      ]);
    } finally {
      await server.close();
    }
  }
);

it('stops the real Pi batch after a terminal tool-port rejection', async () => {
  const server = await scriptedProviderServer([
    {
      deltas: [
        {
          role: 'assistant',
          tool_calls: [0, 1].map((index) => ({
            index,
            id: `call-${index}`,
            type: 'function',
            function: { name: 'lookup', arguments: '{}' },
          })),
        },
      ],
      finishReason: 'tool_calls',
    },
  ]);
  try {
    const calls: string[] = [];
    const failure = new AgentToolError('TOOL_CALL_BUDGET_EXCEEDED', 'terminal');
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor: ordinaryActor(server.baseUrl),
        tools: { registry: toolRegistry(), permissionPolicy: toolPermission },
      },
      stepOverrides: {
        buildTools: async (context) => {
          await buildRequestTools(context);
          const runtime = context.state.tools;
          if (runtime === undefined) throw new Error('Missing ToolRuntime');
          context.state.tools = {
            tools: runtime.tools,
            inspect: () => runtime.inspect(),
            close: () => runtime.close(),
            execute: (call) => {
              calls.push(call.callId);
              return Promise.reject(failure);
            },
          };
        },
      },
    });
    await expect(workflow.run({ input: { message: 'Find facts.' } })).rejects.toBe(failure);
    expect(calls).toEqual(['call-0']);
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});

it('does not start a second Pi request when the Interaction turn budget is exhausted', async () => {
  const server = await scriptedProviderServer([toolTurn]);
  try {
    const workflow = createSessionlessRequestWorkflow({
      mode: 'interaction',
      resources: {
        actor: ordinaryActor(server.baseUrl),
        tools: { registry: toolRegistry(), permissionPolicy: toolPermission },
        policy: { maxModelTurns: 1 },
      },
    });
    await expect(workflow.run({ input: { message: 'Find facts.' } })).rejects.toMatchObject({
      code: 'MODEL_TURN_LIMIT_EXCEEDED',
    });
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});
