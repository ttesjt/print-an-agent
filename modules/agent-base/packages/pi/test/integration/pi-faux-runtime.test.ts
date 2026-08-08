import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopEvent,
} from '@ta-agent/base-model';
import {
  AgentToolError,
  createBoundedToolRuntime,
  createToolRegistry,
  DEFAULT_TOOL_EXECUTION_POLICY,
  DENY_ALL_TOOL_PERMISSION_POLICY,
  EMPTY_TOOL_REGISTRY,
  defineTool,
  defineToolPermissionPolicy,
  type ToolExecutionRequest,
} from '@ta-agent/base-tool';
import { AgentSessionError, DEFAULT_SESSION_BRANCH_ID, parseTurnId } from '@ta-agent/base-session';
import { describe, expect, it, vi } from 'vitest';
import { createPiFauxRuntime } from '../../src/index.js';

function prompt(text: string) {
  return Object.freeze({ role: 'user' as const, text, timestamp: 1 });
}

function emptyTools(signal: AbortSignal) {
  return createBoundedToolRuntime({
    registry: EMPTY_TOOL_REGISTRY,
    permissionPolicy: DENY_ALL_TOOL_PERMISSION_POLICY,
    executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
    signal,
  });
}

const addSchema = {
  type: 'object',
  properties: {
    left: { type: 'number' },
    right: { type: 'number' },
  },
  required: ['left', 'right'],
  additionalProperties: false,
} as const;

function addToolRuntime(
  signal: AbortSignal,
  execute: (left: number, right: number) => Promise<string> = (left, right) =>
    Promise.resolve(String(left + right))
) {
  const handler = vi.fn(async ({ arguments: input }: ToolExecutionRequest<AddInput>) => ({
    text: await execute(input.left, input.right),
  }));
  const tool = defineTool({
    name: 'add',
    description: 'Adds two numbers.',
    parameters: addSchema,
    execute: handler,
  });
  const permissionPolicy = defineToolPermissionPolicy({
    task: ['add'],
    assignment: ['add'],
    product: ['add'],
    runtime: ['add'],
  });
  return {
    handler,
    runtime: createBoundedToolRuntime({
      registry: createToolRegistry([tool]),
      permissionPolicy,
      executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
      signal,
    }),
  };
}

type AddInput = Readonly<{ left: number; right: number }>;

describe('Pi faux Agent Loop runtime', () => {
  it('traverses the real Pi loop and normalizes ordered streaming events', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'hello' }],
      charactersPerChunk: 2,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const events: AgentLoopEvent[] = [];

    const signal = new AbortController().signal;
    const result = await profile.runtime.run({
      target,
      instructions: 'Be concise.',
      history: [],
      prompt: prompt('hi'),
      tools: emptyTools(signal),
      maxProviderTurns: 4,
      maxOutputCharacters: 100,
      signal,
      emit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });

    expect(result.message.text).toBe('hello');
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes.slice(0, 2)).toEqual(['interaction-start', 'turn-start']);
    expect(eventTypes.slice(-3)).toEqual(['assistant-complete', 'turn-end', 'interaction-end']);
    expect(eventTypes.slice(2, -3).every((type) => type === 'text-delta')).toBe(true);
    expect(eventTypes.filter((type) => type === 'text-delta').length).toBeGreaterThan(0);
    expect(
      events.flatMap((event) => (event.type === 'text-delta' ? [event.delta] : [])).join('')
    ).toBe('hello');
    expect(profile.inspect()).toMatchObject({ callCount: 1, pendingResponseCount: 0 });
    expect(profile.inspect().requests[0]).toMatchObject({
      instructions: 'Be concise.',
      messages: [{ role: 'user', text: 'hi' }],
    });
  });

  it('passes completed history and the new prompt through Pi', async () => {
    const profile = createPiFauxRuntime({
      responses: [
        (request) => ({
          status: 'success',
          text: request.messages.map((message) => `${message.role}:${message.text}`).join('|'),
        }),
      ],
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const priorAssistant = Object.freeze({
      role: 'assistant' as const,
      text: 'first answer',
      provider: profile.modelReference.provider,
      model: profile.modelReference.model,
      stopReason: 'stop' as const,
      usage: Object.freeze({
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2,
      }),
      timestamp: 2,
    });

    const signal = new AbortController().signal;
    const result = await profile.runtime.run({
      target,
      instructions: '',
      history: [prompt('first'), priorAssistant],
      prompt: Object.freeze({ role: 'user', text: 'second', timestamp: 3 }),
      tools: emptyTools(signal),
      maxProviderTurns: 4,
      maxOutputCharacters: 1_000,
      signal,
      emit: () => Promise.resolve(),
    });

    expect(result.message.text).toBe('user:first|assistant:first answer|user:second');
  });

  it('maps a provider terminal error after partial output', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'failure', message: 'upstream failed', partialText: 'partial' }],
      charactersPerChunk: 3,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const deltas: string[] = [];
    const signal = new AbortController().signal;

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        tools: emptyTools(signal),
        maxProviderTurns: 4,
        maxOutputCharacters: 100,
        signal,
        emit: (event) => {
          if (event.type === 'text-delta') deltas.push(event.delta);
          return Promise.resolve();
        },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_PROVIDER_FAILED' })
    );
    expect(deltas.join('')).toBe('partial');
  });

  it('propagates cancellation during a paced stream', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'abcdefghij' }],
      charactersPerChunk: 1,
      tokensPerSecond: 1_000,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const controller = new AbortController();

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        tools: emptyTools(controller.signal),
        maxProviderTurns: 4,
        maxOutputCharacters: 100,
        signal: controller.signal,
        emit: (event) => {
          if (event.type === 'text-delta') controller.abort();
          return Promise.resolve();
        },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_INVOCATION_CANCELLED',
      })
    );
  });

  it('aborts when normalized output crosses its bound', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'too long' }],
      charactersPerChunk: 2,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const signal = new AbortController().signal;

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        tools: emptyTools(signal),
        maxProviderTurns: 4,
        maxOutputCharacters: 3,
        signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_OUTPUT_LIMIT_EXCEEDED',
      })
    );
  });

  it('rejects an unregistered Provider Model Reference', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'unused' }],
    });

    await expect(
      profile.runtime.resolveTarget(
        defineProviderModelReference({ provider: 'missing', model: 'model' })
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_TARGET_NOT_FOUND' })
    );
  });

  it('fails closed when a model proposes a tool against the empty tool set', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'tool-call', name: 'unexpected', arguments: { value: 1 } }],
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const signal = new AbortController().signal;

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        tools: emptyTools(signal),
        maxProviderTurns: 4,
        maxOutputCharacters: 100,
        signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({
        code: 'TOOL_NOT_AUTHORIZED',
      })
    );
  });

  it('runs a real Pi tool turn and publishes only the final provider text', async () => {
    const profile = createPiFauxRuntime({
      responses: [
        {
          status: 'tool-call',
          callId: 'call-1',
          name: 'add',
          text: 'intermediate private text',
          arguments: { left: 2, right: 3 },
        },
        (request) => ({
          status: 'success',
          text: `final:${request.toolResults.at(-1)?.text ?? 'missing'}`,
        }),
      ],
      charactersPerChunk: 2,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const signal = new AbortController().signal;
    const tools = addToolRuntime(signal);
    const deltas: string[] = [];

    const result = await profile.runtime.run({
      target,
      instructions: '',
      history: [],
      prompt: prompt('add'),
      tools: tools.runtime,
      maxProviderTurns: 3,
      maxOutputCharacters: 1_000,
      signal,
      emit: (event) => {
        if (event.type === 'text-delta') deltas.push(event.delta);
        return Promise.resolve();
      },
    });

    expect(result.message.text).toBe('final:5');
    expect(deltas.join('')).toBe('final:5');
    expect(deltas.join('')).not.toContain('intermediate private text');
    expect(tools.handler).toHaveBeenCalledTimes(1);
    expect(tools.runtime.inspect()).toMatchObject({
      status: 'open',
      records: [{ callId: 'call-1', toolName: 'add', status: 'success' }],
    });
    expect(profile.inspect()).toMatchObject({
      callCount: 2,
      toolEvents: [
        { type: 'tool-call-start', callId: 'call-1', toolName: 'add' },
        { type: 'tool-call-end', callId: 'call-1', toolName: 'add', status: 'success' },
      ],
    });
    expect(profile.inspect().requests[1]?.toolResults).toEqual([
      { callId: 'call-1', toolName: 'add', text: '5', isError: false },
    ]);
  });

  it('fails malformed Pi tool arguments before the Agent Base handler', async () => {
    const profile = createPiFauxRuntime({
      responses: [
        { status: 'tool-call', callId: 'bad', name: 'add', arguments: { left: 'two', right: 3 } },
      ],
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const signal = new AbortController().signal;
    const tools = addToolRuntime(signal);

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('add'),
        tools: tools.runtime,
        maxProviderTurns: 3,
        maxOutputCharacters: 1_000,
        signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_ARGUMENTS_INVALID' })
    );
    expect(tools.handler).not.toHaveBeenCalled();
  });

  it('returns an ordinary handler error to Pi so the model can recover', async () => {
    const profile = createPiFauxRuntime({
      responses: [
        { status: 'tool-call', callId: 'handler', name: 'add', arguments: { left: 2, right: 3 } },
        (request) => ({
          status: 'success',
          text: request.toolResults.at(-1)?.isError === true ? 'recovered' : 'unexpected',
        }),
      ],
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const signal = new AbortController().signal;
    const tools = addToolRuntime(signal, () => Promise.reject(new Error('handler failed')));

    const result = await profile.runtime.run({
      target,
      instructions: '',
      history: [],
      prompt: prompt('add'),
      tools: tools.runtime,
      maxProviderTurns: 3,
      maxOutputCharacters: 1_000,
      signal,
      emit: () => Promise.resolve(),
    });

    expect(result.message.text).toBe('recovered');
    expect(profile.inspect().requests[1]?.toolResults[0]).toEqual({
      callId: 'handler',
      toolName: 'add',
      text: 'Tool execution failed.',
      isError: true,
    });
  });

  it('enforces duplicate call identity and provider-turn budget across Pi turns', async () => {
    const duplicateProfile = createPiFauxRuntime({
      responses: [
        { status: 'tool-call', callId: 'same', name: 'add', arguments: { left: 1, right: 1 } },
        { status: 'tool-call', callId: 'same', name: 'add', arguments: { left: 2, right: 2 } },
      ],
    });
    const duplicateTarget = await duplicateProfile.runtime.resolveTarget(
      duplicateProfile.modelReference
    );
    const duplicateSignal = new AbortController().signal;
    const duplicateTools = addToolRuntime(duplicateSignal);
    await expect(
      duplicateProfile.runtime.run({
        target: duplicateTarget,
        instructions: '',
        history: [],
        prompt: prompt('add'),
        tools: duplicateTools.runtime,
        maxProviderTurns: 3,
        maxOutputCharacters: 1_000,
        signal: duplicateSignal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_CALL_DUPLICATE' })
    );
    expect(duplicateTools.handler).toHaveBeenCalledTimes(1);

    const budgetProfile = createPiFauxRuntime({
      responses: [
        { status: 'tool-call', callId: 'one', name: 'add', arguments: { left: 1, right: 1 } },
      ],
    });
    const budgetTarget = await budgetProfile.runtime.resolveTarget(budgetProfile.modelReference);
    const budgetSignal = new AbortController().signal;
    const budgetTools = addToolRuntime(budgetSignal);
    await expect(
      budgetProfile.runtime.run({
        target: budgetTarget,
        instructions: '',
        history: [],
        prompt: prompt('add'),
        tools: budgetTools.runtime,
        maxProviderTurns: 1,
        maxOutputCharacters: 1_000,
        signal: budgetSignal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_PROVIDER_TURN_LIMIT_EXCEEDED',
      })
    );
    expect(budgetProfile.inspect().callCount).toBe(1);
  });
});

describe('Pi faux Session compaction runtime', () => {
  const compactionModel = defineProviderModelReference({
    provider: 'faux',
    model: 'faux-model',
  });
  const usage = Object.freeze({
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
  });

  function completedTurn(text: string, timestamp: number) {
    return Object.freeze({
      status: 'completed' as const,
      turnId: parseTurnId(`turn-${timestamp}`),
      branchId: DEFAULT_SESSION_BRANCH_ID,
      userMessage: prompt(`user-${text}`),
      assistantMessage: Object.freeze({
        role: 'assistant' as const,
        text: `assistant-${text}`,
        provider: compactionModel.provider,
        model: compactionModel.model,
        stopReason: 'stop' as const,
        usage,
        timestamp,
      }),
    });
  }

  it('uses one direct Pi completion with previous context and ordered new turns', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'new compacted context' }],
    });

    await expect(
      profile.runtime.compact({
        modelReference: profile.modelReference,
        instructions: 'Compact safely.',
        previousContext: { role: 'context', text: 'prior context', timestamp: 1 },
        turns: [completedTurn('one', 2), completedTurn('two', 3)],
        maxContextCharacters: 100,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ text: 'new compacted context' });

    expect(profile.inspect()).toMatchObject({ callCount: 1, pendingResponseCount: 0 });
    const inspection = profile.inspect().requests[0];
    expect(inspection?.kind).toBe('session-compaction');
    expect(inspection?.instructions).toBe('Compact safely.');
    expect(inspection?.messages[0]?.role).toBe('user');
    expect(inspection?.messages[0]?.text).toContain('prior context');
    expect(inspection?.messages.slice(1)).toMatchObject([
      { role: 'user', text: 'user-one' },
      { role: 'assistant', text: 'assistant-one' },
      { role: 'user', text: 'user-two' },
      { role: 'assistant', text: 'assistant-two' },
      { role: 'user', text: 'Produce the compacted session context.' },
    ]);
  });

  it('rejects provider failure, invalid output, and wrong targets with Session errors', async () => {
    const failed = createPiFauxRuntime({
      responses: [{ status: 'failure', message: 'private provider failure' }],
    });
    await expect(
      failed.runtime.compact({
        modelReference: failed.modelReference,
        instructions: '',
        turns: [completedTurn('one', 1)],
        maxContextCharacters: 100,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({
        code: 'SESSION_COMPACTION_RUNTIME_FAILED',
      })
    );

    const oversized = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'too long' }],
    });
    await expect(
      oversized.runtime.compact({
        modelReference: oversized.modelReference,
        instructions: '',
        turns: [completedTurn('one', 1)],
        maxContextCharacters: 3,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({
        code: 'SESSION_COMPACTION_OUTPUT_INVALID',
      })
    );

    const empty = createPiFauxRuntime({
      responses: [{ status: 'success', text: '' }],
    });
    await expect(
      empty.runtime.compact({
        modelReference: empty.modelReference,
        instructions: '',
        turns: [completedTurn('one', 1)],
        maxContextCharacters: 100,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({
        code: 'SESSION_COMPACTION_OUTPUT_INVALID',
      })
    );

    const wrongTarget = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'unused' }],
    });
    await expect(
      wrongTarget.runtime.compact({
        modelReference: defineProviderModelReference({
          provider: 'missing',
          model: 'missing-model',
        }),
        instructions: '',
        turns: [completedTurn('one', 1)],
        maxContextCharacters: 100,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({
        code: 'SESSION_COMPACTION_RUNTIME_FAILED',
      })
    );
    expect(wrongTarget.inspect()).toMatchObject({ callCount: 0, pendingResponseCount: 1 });
  });

  it('honors a cancelled direct compaction invocation', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'unused' }],
      tokensPerSecond: 1,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      profile.runtime.compact({
        modelReference: profile.modelReference,
        instructions: '',
        turns: [completedTurn('one', 1)],
        maxContextCharacters: 100,
        signal: controller.signal,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({
        code: 'SESSION_COMPACTION_CANCELLED',
      })
    );
  });
});
