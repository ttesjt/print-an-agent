import { AgentModelError } from '@ta-agent/base-model';
import {
  createBoundedToolRuntime,
  createToolRegistry,
  defineTool,
  defineToolPermissionPolicy,
  DEFAULT_TOOL_EXECUTION_POLICY,
} from '@ta-agent/base-tool';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiProviderRuntime } from '../../src/index.js';
import {
  createOpenAICompatibleTestServer,
  createScriptedOpenAICompatibleTestServer,
  type OpenAICompatibleTestServer,
} from '../support/openai-compatible-server.js';

const servers: OpenAICompatibleTestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startServer(responseText?: string): Promise<OpenAICompatibleTestServer> {
  const server = await createOpenAICompatibleTestServer(responseText);
  servers.push(server);
  return server;
}

async function startTimedServer(
  timing: Parameters<typeof createOpenAICompatibleTestServer>[2],
  reasoning?: string
): Promise<OpenAICompatibleTestServer> {
  const server = await createOpenAICompatibleTestServer('timed response', reasoning, timing);
  servers.push(server);
  return server;
}

function providerConfig(baseUrl: string) {
  return {
    kind: 'openai-compatible' as const,
    reference: { provider: 'local-keyless', model: 'test-model', baseUrl },
    contextWindowTokens: 4_096,
    maxOutputTokens: 512,
    supportsReasoning: true,
    compatibility: { supportsDeveloperRole: false },
  };
}

function emptyTools(signal: AbortSignal) {
  return createBoundedToolRuntime({
    registry: createToolRegistry([]),
    permissionPolicy: defineToolPermissionPolicy({
      responsibility: [],
      actor: [],
      product: [],
      runtime: [],
    }),
    executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
    signal,
  });
}

function delayedLookupTools(signal: AbortSignal, delayMilliseconds: number) {
  const execute = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    return { text: 'lookup result' };
  });
  const tool = defineTool({
    name: 'lookup',
    description: 'Returns a lookup result.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execute,
  });
  return {
    execute,
    runtime: createBoundedToolRuntime({
      registry: createToolRegistry([tool]),
      permissionPolicy: defineToolPermissionPolicy({
        responsibility: ['lookup'],
        actor: ['lookup'],
        product: ['lookup'],
        runtime: ['lookup'],
      }),
      executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
      signal,
    }),
  };
}

function directRequest() {
  return {
    instructions: 'Reply briefly.',
    messages: [{ role: 'user' as const, text: 'hello', timestamp: 1 }],
    maxOutputCharacters: 1_000,
    signal: new AbortController().signal,
    invocationConfig: Object.freeze({ temperature: 0 }),
  };
}

function captureModelError(action: () => unknown): AgentModelError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof AgentModelError) return error;
    throw error;
  }
  throw new Error('Expected an AgentModelError.');
}

describe('ordinary Pi provider runtime', () => {
  it('uses a credential reference across the real Pi public boundary without exposing its secret', async () => {
    const server = await startServer('credential response');
    const resolver = {
      resolve: vi.fn(() =>
        Promise.resolve({ type: 'api-key' as const, apiKey: 'PRIVATE_TEST_KEY' })
      ),
    };
    const profile = createPiProviderRuntime({
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'local-openai',
          model: 'test-model',
          baseUrl: server.baseUrl,
          credentialRef: 'credentials/local-openai',
        },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
      credentialResolver: resolver,
    });

    await expect(profile.checkReadiness()).resolves.toMatchObject({ status: 'ready' });
    await expect(profile.actorEngine.complete?.(directRequest())).resolves.toMatchObject({
      message: { text: 'credential response' },
    });

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(server.requests()).toHaveLength(1);
    expect(server.requests()[0]?.url).toBe('/v1/chat/completions');
    expect(server.requests()[0]?.headers.authorization).toBe('Bearer PRIVATE_TEST_KEY');
    expect(profile.inspect()).toEqual({
      kind: 'openai-compatible',
      provider: 'local-openai',
      model: 'test-model',
      baseUrl: server.baseUrl,
      authentication: 'credential-reference',
      actorEngineId: 'provider',
      contextWindowTokens: 8_192,
      maxOutputTokens: 1_024,
      supportsReasoning: false,
      compatibility: { supportsDeveloperRole: false },
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: null,
      },
    });
    expect(JSON.stringify(profile.inspect())).not.toContain('PRIVATE_TEST_KEY');
    expect(JSON.stringify(profile.inspect())).not.toContain('credentials/local-openai');
    expect(Object.isFrozen(profile.inspect())).toBe(true);
  });

  it('supports an explicitly keyless OpenAI-compatible endpoint', async () => {
    const server = await startServer('keyless response');
    const profile = createPiProviderRuntime({
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'local-keyless',
          model: 'test-model',
          baseUrl: server.baseUrl,
        },
        contextWindowTokens: 4_096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
    });

    await expect(profile.checkReadiness()).resolves.toMatchObject({ status: 'ready' });
    await expect(profile.actorEngine.complete?.(directRequest())).resolves.toMatchObject({
      message: { text: 'keyless response' },
    });
    expect(server.requests()[0]?.headers.authorization).toBeUndefined();
    expect(profile.inspect().authentication).toBe('keyless');
  });

  it('reports a missing credential without making a provider request', async () => {
    const server = await startServer();
    const profile = createPiProviderRuntime({
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'local-openai',
          model: 'test-model',
          baseUrl: server.baseUrl,
          credentialRef: 'credentials/missing',
        },
        contextWindowTokens: 4_096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
      credentialResolver: { resolve: () => Promise.resolve(undefined) },
    });

    await expect(profile.checkReadiness()).resolves.toMatchObject({
      status: 'credential-unavailable',
    });
    await expect(profile.actorEngine.complete?.(directRequest())).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_CREDENTIAL_NOT_FOUND' })
    );
    expect(server.requests()).toHaveLength(0);
  });

  it('adds no transport deadline by default, even when response start is delayed', async () => {
    const server = await startTimedServer({ responseStartDelayMilliseconds: 50 });
    const profile = createPiProviderRuntime({ provider: providerConfig(server.baseUrl) });

    await expect(profile.actorEngine.complete?.(directRequest())).resolves.toMatchObject({
      message: { text: 'timed response' },
    });
    expect(profile.inspect().transportLivenessPolicy).toEqual({
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: null,
    });
  });

  it('fails direct completion with its owned response-start timeout', async () => {
    const server = await startTimedServer({ responseStartDelayMilliseconds: 100 });
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 20,
        streamEventIdleTimeoutMilliseconds: null,
      },
    });

    await expect(profile.actorEngine.complete?.(directRequest())).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_PROVIDER_RESPONSE_START_TIMEOUT',
      })
    );
  });

  it('fails an interaction when a started provider stream stops producing events', async () => {
    const server = await startTimedServer({ terminalEventDelayMilliseconds: 100 });
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: 20,
      },
    });
    const signal = new AbortController().signal;
    const tools = emptyTools(signal);

    try {
      await expect(
        profile.actorEngine.interact?.({
          instructions: 'Reply briefly.',
          history: [],
          prompt: { role: 'user', text: 'hello', timestamp: 1 },
          tools,
          maxModelTurns: 1,
          maxOutputCharacters: 1_000,
          signal,
          invocationConfig: {},
          emit: () => Promise.resolve(),
        })
      ).rejects.toEqual(
        expect.objectContaining<Partial<AgentModelError>>({
          code: 'MODEL_PROVIDER_STREAM_IDLE_TIMEOUT',
        })
      );
    } finally {
      tools.close();
    }
  });

  it('starts the idle deadline after response headers while awaiting the first event', async () => {
    const server = await startTimedServer({ firstEventDelayMilliseconds: 100 });
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: 20,
      },
    });

    await expect(profile.actorEngine.complete?.(directRequest())).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_PROVIDER_STREAM_IDLE_TIMEOUT',
      })
    );
  });

  it('resets the idle deadline as normalized reasoning, text, and terminal events arrive', async () => {
    const server = await startTimedServer(
      {
        firstEventDelayMilliseconds: 15,
        contentEventDelayMilliseconds: 15,
        terminalEventDelayMilliseconds: 15,
      },
      'thinking'
    );
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 60,
        streamEventIdleTimeoutMilliseconds: 60,
      },
    });

    await expect(profile.actorEngine.complete?.(directRequest())).resolves.toMatchObject({
      message: { text: 'timed response' },
    });
  });

  it('does not charge downstream event backpressure to provider stream idleness', async () => {
    const server = await startServer('backpressured response');
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: 20,
      },
    });
    const signal = new AbortController().signal;
    const tools = emptyTools(signal);

    try {
      await expect(
        profile.actorEngine.interact?.({
          instructions: 'Reply briefly.',
          history: [],
          prompt: { role: 'user', text: 'hello', timestamp: 1 },
          tools,
          maxModelTurns: 1,
          maxOutputCharacters: 1_000,
          signal,
          invocationConfig: {},
          emit: (event) =>
            event.type === 'text-delta'
              ? new Promise((resolve) => setTimeout(resolve, 50))
              : Promise.resolve(),
        })
      ).resolves.toMatchObject({ message: { text: 'backpressured response' } });
    } finally {
      tools.close();
    }
  });

  it('rebuilds provider liveness boundaries for every model turn in a real Tool loop', async () => {
    const server = await createScriptedOpenAICompatibleTestServer([
      {
        kind: 'tool-call',
        id: 'lookup-call-1',
        name: 'lookup',
        arguments: {},
      },
      {
        kind: 'text',
        text: 'answer after lookup',
        timing: { responseStartDelayMilliseconds: 40 },
      },
    ]);
    servers.push(server);
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 80,
        streamEventIdleTimeoutMilliseconds: 80,
      },
    });
    const signal = new AbortController().signal;
    const tools = delayedLookupTools(signal, 120);

    try {
      await expect(
        profile.actorEngine.interact?.({
          instructions: 'Use the lookup tool before answering.',
          history: [],
          prompt: { role: 'user', text: 'lookup this', timestamp: 1 },
          tools: tools.runtime,
          maxModelTurns: 2,
          maxOutputCharacters: 1_000,
          signal,
          invocationConfig: {},
          emit: () => Promise.resolve(),
        })
      ).resolves.toMatchObject({ message: { text: 'answer after lookup' } });

      expect(tools.execute).toHaveBeenCalledTimes(1);
      expect(server.requests()).toHaveLength(2);
      const secondRequest = server.requests()[1]?.body as
        | Readonly<{ messages?: readonly Readonly<{ role?: unknown }>[] }>
        | undefined;
      expect(secondRequest?.messages?.some((message) => message.role === 'tool')).toBe(true);
    } finally {
      tools.runtime.close();
    }
  });

  it('preserves caller cancellation instead of relabelling it as provider timeout', async () => {
    const server = await startTimedServer({ responseStartDelayMilliseconds: 100 });
    const profile = createPiProviderRuntime({
      provider: providerConfig(server.baseUrl),
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 80,
        streamEventIdleTimeoutMilliseconds: 80,
      },
    });
    const controller = new AbortController();
    const cancellation = setTimeout(() => controller.abort(new Error('caller cancelled')), 15);

    try {
      await expect(
        profile.actorEngine.complete?.({ ...directRequest(), signal: controller.signal })
      ).rejects.toEqual(
        expect.objectContaining<Partial<AgentModelError>>({
          code: 'MODEL_INVOCATION_CANCELLED',
        })
      );
    } finally {
      clearTimeout(cancellation);
    }
  });

  it('normalizes malformed and throwing credential resolvers without exposing their details', async () => {
    const server = await startServer();
    const malformed = createPiProviderRuntime({
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'local-openai',
          model: 'test-model',
          baseUrl: server.baseUrl,
          credentialRef: 'credentials/private-malformed',
        },
        contextWindowTokens: 4_096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
      credentialResolver: {
        resolve: () => Promise.resolve({ type: 'api-key', apiKey: '' }),
      },
    });
    const throwing = createPiProviderRuntime({
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'local-openai',
          model: 'test-model',
          baseUrl: server.baseUrl,
          credentialRef: 'credentials/private-throwing',
        },
        contextWindowTokens: 4_096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
      credentialResolver: {
        resolve: () => Promise.reject(new Error('PRIVATE_RESOLVER_DETAIL')),
      },
    });

    for (const profile of [malformed, throwing]) {
      let failure: unknown;
      try {
        await profile.actorEngine.complete?.(directRequest());
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toEqual(
        expect.objectContaining<Partial<AgentModelError>>({
          code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED',
        })
      );
      expect((failure as Error).message).not.toContain('credentials/private');
      expect((failure as Error).message).not.toContain('PRIVATE_RESOLVER_DETAIL');
      expect((failure as Error).message).not.toContain(server.baseUrl);
    }
    expect(server.requests()).toHaveLength(0);
  });

  it('rejects unknown Pi builtin providers before invocation', () => {
    const error = captureModelError(() =>
      createPiProviderRuntime({
        provider: {
          kind: 'builtin',
          reference: {
            provider: 'not-a-pi-provider',
            model: 'missing',
            credentialRef: 'credentials/missing',
          },
        },
      })
    );
    expect(error.code).toBe('MODEL_PROVIDER_NOT_FOUND');
  });

  it('reports the reasoning capability owned by the builtin Pi catalog', () => {
    const profile = createPiProviderRuntime({
      provider: {
        kind: 'builtin',
        reference: {
          provider: 'openai',
          model: 'gpt-5-mini',
          credentialRef: 'credentials/openai',
        },
      },
    });

    expect(profile.inspect()).toMatchObject({
      kind: 'builtin',
      provider: 'openai',
      model: 'gpt-5-mini',
      supportsReasoning: true,
    });
    expect(profile.inspect()).not.toHaveProperty('compatibility');
  });

  it('rejects unknown models within a Pi builtin provider', () => {
    const error = captureModelError(() =>
      createPiProviderRuntime({
        provider: {
          kind: 'builtin',
          reference: {
            provider: 'openai',
            model: 'definitely-not-a-model',
            credentialRef: 'credentials/openai',
          },
        },
      })
    );
    expect(error.code).toBe('MODEL_TARGET_NOT_FOUND');
  });
});
