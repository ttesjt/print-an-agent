import {
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
  createAgentActorCatalog,
  createResponsibilityCatalog,
} from '@print-an-agent/agent-actor';
import { type ActorEngineInteractionRequest } from '@print-an-agent/model-invocation-core';
import { composeAgent, createAgentAPI } from '@print-an-agent/base-composition';
import { MemoryAgentTraceAdapter, MemoryOutputSink } from '@print-an-agent/base-local-adapters';
import {
  ModelInvocationError,
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';
import type { DefaultRequestWorkflowContext } from '@print-an-agent/base-request';
import { createToolRegistry, defineTool } from '@print-an-agent/base-tool';
import { describe, expect, it, vi } from 'vitest';

function createAssistantMessage(text: string) {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'consumer.runtime-target',
      evidence: { targetId: 'consumer-target-1' },
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    timestamp: 1,
  });
}

async function interact(request: ActorEngineInteractionRequest) {
  if (request.signal.aborted) {
    throw new ModelInvocationError('MODEL_INVOCATION_CANCELLED', 'Consumer Engine was cancelled.');
  }
  await request.emit({ type: 'interaction-start' });
  await request.emit({ type: 'turn-start' });
  const proposal = Object.freeze({
    callId: 'consumer-call',
    toolName: 'lookup-label',
    arguments: Object.freeze({ key: request.prompt.text }),
  });
  await request.emit({
    type: 'tool-call-start',
    callId: proposal.callId,
    toolName: proposal.toolName,
  });
  const outcome = await request.tools.execute(proposal);
  await request.emit({
    type: 'tool-call-end',
    callId: proposal.callId,
    toolName: proposal.toolName,
    status: outcome.status === 'success' ? 'success' : 'error',
    resultCharacters: outcome.text.length,
  });
  const message = createAssistantMessage(`resolved:${outcome.text}`);
  await request.emit({ type: 'text-delta', delta: message.text });
  await request.emit({ type: 'assistant-complete', message });
  await request.emit({ type: 'turn-end' });
  await request.emit({ type: 'interaction-end' });
  return Object.freeze({ message });
}

function createConsumerAgent(interaction: typeof interact = interact) {
  const actorCatalog = createAgentActorCatalog({
    engines: [
      {
        id: 'consumer-engine',
        capabilities: {
          invocationModes: ['interaction', 'direct'],
          inputMediaTypes: ['text'],
          interaction: { streamable: true },
          toolCalling: true,
          structuredOutput: false,
          cancellation: true,
          maxContextTokens: 8_192,
        },
        interact: interaction,
        complete: ({ signal }) => {
          if (signal.aborted) {
            throw new ModelInvocationError(
              'MODEL_INVOCATION_CANCELLED',
              'Consumer Engine was cancelled.'
            );
          }
          return Promise.resolve(Object.freeze({ message: createAssistantMessage('compacted') }));
        },
      },
    ],
    actors: [
      {
        id: MAIN_ACTOR_ID,
        engineId: 'consumer-engine',
        allowedTools: ['lookup-label'],
      },
    ],
  });
  const responsibilityCatalog = createResponsibilityCatalog({
    responsibilities: BUILT_IN_RESPONSIBILITIES.map((responsibility) =>
      responsibility.id === 'foreground-interaction'
        ? { ...responsibility, allowedTools: ['lookup-label'] }
        : responsibility
    ),
  });
  const tool = defineTool({
    name: 'lookup-label',
    description: 'Resolve a label for public consumer qualification.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', minLength: 1, maxLength: 128 } },
      required: ['key'],
      additionalProperties: false,
    },
    execute: ({ arguments: toolArguments }) =>
      Promise.resolve(Object.freeze({ text: `label:${toolArguments.key}` })),
  });
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
  const gatherExternalContext = vi.fn((_context: DefaultRequestWorkflowContext) =>
    Promise.resolve()
  );
  const agent = composeAgent({
    identity: { id: 'public-consumer' },
    actorCatalog,
    responsibilityCatalog,
    toolRegistry: createToolRegistry([tool]),
    productToolAllowList: ['lookup-label'],
    runtimeToolAllowList: ['lookup-label'],
    stepOverrides: { gatherExternalContext },
    observability: { sink: trace, clock: () => 1 },
  });
  return Object.freeze({ agent, trace, gatherExternalContext });
}

describe('public Agent integration', () => {
  it('uses a custom Engine, Tool, Step override, raw Agent, and transparent API projection', async () => {
    const { agent, trace, gatherExternalContext } = createConsumerAgent();
    const sink = new MemoryOutputSink();
    const response = await agent.invoke('foreground', {
      message: 'blue',
      outputSink: sink,
    });
    const api = createAgentAPI(agent);

    expect(response).toMatchObject({
      message: {
        text: 'resolved:label:blue',
        provenance: {
          kind: 'engine-defined',
          type: 'consumer.runtime-target',
          evidence: { targetId: 'consumer-target-1' },
        },
      },
      toolRun: { records: [{ toolName: 'lookup-label', status: 'success' }] },
    });
    expect(sink.inspect()).toMatchObject({
      status: 'closed',
      events: [{ type: 'text-delta', delta: 'resolved:label:blue' }],
    });
    expect(gatherExternalContext).toHaveBeenCalledOnce();
    expect(api.agent).toBe(agent);
    expect(api.identity).toBe(agent.identity);
    expect(api.operationNames).toEqual(agent.operationNames);

    const serializedTrace = JSON.stringify(trace.inspect());
    expect(serializedTrace).not.toContain('blue');
    expect(serializedTrace).not.toContain('label:blue');
    expect(serializedTrace).not.toContain('consumer-target-1');
    expect(serializedTrace).not.toContain('Respond helpfully and concisely.');
  });

  it('propagates cancellation as a structured failure and fails the OutputSink once', async () => {
    const started = Promise.withResolvers<void>();
    const { agent } = createConsumerAgent((request) => {
      started.resolve();
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => {
            reject(
              new ModelInvocationError(
                'MODEL_INVOCATION_CANCELLED',
                'Consumer Engine was cancelled.'
              )
            );
          },
          { once: true }
        );
      });
    });
    const sink = new MemoryOutputSink();
    const fail = vi.spyOn(sink, 'fail');
    const controller = new AbortController();
    const run = agent.invoke(
      'foreground',
      { message: 'cancel me', outputSink: sink },
      { signal: controller.signal }
    );
    const checked = expect(run).rejects.toMatchObject({ code: 'MODEL_INVOCATION_CANCELLED' });
    await started.promise;
    controller.abort('consumer cancelled');
    await checked;
    expect(fail).toHaveBeenCalledOnce();
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_INVOCATION_CANCELLED' },
    });
  });

  it('rejects an already-cancelled invocation before acquiring request resources or touching output', async () => {
    const engine = vi.fn(interact);
    const { agent, gatherExternalContext } = createConsumerAgent(engine);
    const sink = new MemoryOutputSink();
    const fail = vi.spyOn(sink, 'fail');
    const open = vi.spyOn(sink, 'open');
    const source = new AbortController();
    const cancellation = new Error('cancel before admission');
    source.abort(cancellation);
    await expect(
      agent.invoke(
        'foreground',
        { message: 'cancel me', outputSink: sink },
        {
          signal: source.signal,
        }
      )
    ).rejects.toBe(cancellation);
    expect(engine).not.toHaveBeenCalled();
    expect(gatherExternalContext).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
