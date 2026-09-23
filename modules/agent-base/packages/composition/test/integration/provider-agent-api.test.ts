import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MemoryAgentTraceAdapter, MemoryOutputSink } from '@ta-agent/base-local-adapters';
import { AgentModelError, type ProviderCredentialResolutionRequest } from '@ta-agent/base-model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderAgentAPI } from '../../src/index.js';

interface TestServer {
  readonly baseUrl: string;
  requests(): readonly Readonly<Record<string, unknown>>[];
  close(): Promise<void>;
}

const servers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function startServer(): Promise<TestServer> {
  const captured: Readonly<Record<string, unknown>>[] = [];
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      response.destroy();
    });
  });
  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request as AsyncIterable<unknown>) {
      if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(chunk);
      else throw new Error('Unexpected test request body chunk.');
    }
    const parsedBody: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
      throw new Error('Expected an object request body.');
    }
    captured.push(Object.freeze({ ...parsedBody }));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-agent-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'agent-test-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'ordinary agent response' },
            finish_reason: null,
          },
        ],
      })}\n\n`
    );
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-agent-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'agent-test-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
      })}\n\n`
    );
    response.end('data: [DONE]\n\n');
  }
  const port = await listen(server);
  const testServer = Object.freeze({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests: () => Object.freeze([...captured]),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  });
  servers.push(testServer);
  return testServer;
}

describe('ordinary Pi Agent Base composition', () => {
  it('runs two memory-session turns through the main Actor and streams a closed output', async () => {
    const server = await startServer();
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    const resolver = {
      resolve: vi.fn((_request: ProviderCredentialResolutionRequest) =>
        Promise.resolve({ type: 'api-key' as const, apiKey: 'PRIVATE_AGENT_KEY' })
      ),
    };
    const agent = createProviderAgentAPI({
      identity: { id: 'ordinary-agent' },
      instructionContributors: [() => 'PRIVATE_AGENT_INSTRUCTION'],
      observability: { sink: trace, clock: () => 1 },
      mainActor: { invocationConfig: { temperature: 0, maxOutputTokens: 128 } },
      sessionCompactionPolicy: {
        minimumCompletedTurns: 2,
        retainRecentTurns: 1,
        maxSourceTurns: 8,
        maxSourceCharacters: 8_192,
        maxContextCharacters: 1_024,
        timeoutMilliseconds: 5_000,
      },
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: {
            provider: 'local-openai',
            model: 'agent-test-model',
            baseUrl: server.baseUrl,
            credentialRef: 'credentials/ordinary-agent',
          },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
        credentialResolver: resolver,
      },
    });
    const firstSink = new MemoryOutputSink();

    await expect(agent.checkProviderReadiness()).resolves.toMatchObject({ status: 'ready' });
    await expect(
      agent.run({ message: 'first turn', sessionId: 'ordinary-session', outputSink: firstSink })
    ).resolves.toMatchObject({ message: { text: 'ordinary agent response' } });
    await expect(
      agent.run({ message: 'second turn', sessionId: 'ordinary-session' })
    ).resolves.toMatchObject({ message: { text: 'ordinary agent response' } });
    await expect(agent.compactSession({ sessionId: 'ordinary-session' })).resolves.toMatchObject({
      status: 'compacted',
      compactedTurnCount: 1,
    });

    expect(firstSink.inspect()).toMatchObject({
      status: 'closed',
      events: [{ type: 'text-delta', delta: 'ordinary agent response' }],
    });
    expect(server.requests()).toHaveLength(3);
    expect(server.requests()[0]).toMatchObject({ temperature: 0, max_completion_tokens: 128 });
    expect(JSON.stringify(server.requests()[0])).toContain('PRIVATE_AGENT_INSTRUCTION');
    expect(JSON.stringify(server.requests()[1])).toContain('first turn');
    expect(JSON.stringify(server.requests()[1])).toContain('ordinary agent response');
    expect(JSON.stringify(server.requests()[1])).toContain('second turn');
    expect(JSON.stringify(server.requests()[2])).toContain(
      'Produce the compacted session context.'
    );
    expect(resolver.resolve).toHaveBeenCalledTimes(4);
    const firstResolution = resolver.resolve.mock.calls[0]?.[0];
    expect(firstResolution).toMatchObject({
      reference: 'credentials/ordinary-agent',
      provider: 'local-openai',
    });
    expect(firstResolution?.signal).toBeInstanceOf(AbortSignal);
    expect(agent.agent.resources.responsibilities.mainActorId).toBe('main');
    expect(agent.inspectProvider()).toMatchObject({
      kind: 'openai-compatible',
      authentication: 'credential-reference',
      actorEngineId: 'provider',
    });
    expect(JSON.stringify(agent.inspectProvider())).not.toContain('credentials/ordinary-agent');
    expect(JSON.stringify(trace.inspect())).not.toContain('PRIVATE_AGENT_KEY');
    expect(JSON.stringify(trace.inspect())).not.toContain('credentials/ordinary-agent');
    expect(JSON.stringify(trace.inspect())).not.toContain('PRIVATE_AGENT_INSTRUCTION');
    expect(JSON.stringify(trace.inspect())).not.toContain(server.baseUrl);
  });

  it('fails before provider I/O when the configured credential is unavailable', async () => {
    const sink = new MemoryOutputSink();
    const agent = createProviderAgentAPI({
      identity: { id: 'ordinary-agent' },
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: {
            provider: 'local-openai',
            model: 'agent-test-model',
            baseUrl: 'http://127.0.0.1:1/v1',
            credentialRef: 'credentials/missing',
          },
          contextWindowTokens: 4_096,
          maxOutputTokens: 512,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
        credentialResolver: { resolve: () => Promise.resolve(undefined) },
      },
    });

    await expect(agent.checkProviderReadiness()).resolves.toMatchObject({
      status: 'credential-unavailable',
    });
    await expect(agent.run({ message: 'hello', outputSink: sink })).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_CREDENTIAL_NOT_FOUND' })
    );
    expect(sink.inspect()).toMatchObject({
      status: 'failed',
      failure: { code: 'MODEL_CREDENTIAL_NOT_FOUND' },
    });
  });
});
