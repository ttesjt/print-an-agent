import { AgentModelError } from '@ta-agent/base-model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiProviderRuntime } from '../../src/index.js';
import {
  createOpenAICompatibleTestServer,
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
      actorEngineId: 'pi-provider',
      contextWindowTokens: 8_192,
      maxOutputTokens: 1_024,
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
