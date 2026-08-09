import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface CliResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly standardOutput: string;
  readonly standardError: string;
}

interface LoopbackServer {
  readonly baseUrl: string;
  requests(): readonly Readonly<Record<string, unknown>>[];
  waitForRequest(): Promise<void>;
  close(): Promise<void>;
}

const temporaryDirectories: string[] = [];
const servers: LoopbackServer[] = [];
const cliEntryPoint = new URL('../../dist/main.js', import.meta.url);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Loopback server did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function readRequestBody(
  request: IncomingMessage
): Promise<Readonly<Record<string, unknown>>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new Error('Loopback server received an invalid request chunk.');
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Loopback server expected an object request body.');
  }
  return Object.freeze({ ...parsed });
}

function writeChunk(response: ServerResponse, content: string): void {
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-cli-test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cli-test-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content },
          finish_reason: null,
        },
      ],
    })}\n\n`
  );
}

async function startLoopbackServer(hang = false): Promise<LoopbackServer> {
  const captured: Readonly<Record<string, unknown>>[] = [];
  let notifyRequest: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => {
    notifyRequest = resolve;
  });
  const server = createServer((request, response) => {
    void (async () => {
      captured.push(await readRequestBody(request));
      notifyRequest?.();
      notifyRequest = undefined;
      if (hang) return;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      writeChunk(response, 'loopback ');
      writeChunk(response, 'response');
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-cli-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'cli-test-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        })}\n\n`
      );
      response.end('data: [DONE]\n\n');
    })().catch(() => response.destroy());
  });
  const port = await listen(server);
  const result: LoopbackServer = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests: () => Object.freeze([...captured]),
    waitForRequest: () => firstRequest,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
  servers.push(result);
  return result;
}

async function createConfig(server: LoopbackServer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-base-cli-'));
  temporaryDirectories.push(directory);
  const configPath = join(directory, 'agent.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      identity: { id: 'cli-agent' },
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'loopback',
          model: 'cli-test-model',
          baseUrl: server.baseUrl,
        },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
      },
      persistence: { kind: 'sqlite', databasePath: join(directory, 'agent.sqlite') },
      mainActor: { invocationConfig: { temperature: 0, maxOutputTokens: 128 } },
    })
  );
  return configPath;
}

function runCli(arguments_: readonly string[]): {
  readonly completion: Promise<CliResult>;
  interrupt(): void;
} {
  const child = spawn(process.execPath, [cliEntryPoint.pathname, ...arguments_], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let standardOutput = '';
  let standardError = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    standardOutput += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    standardError += chunk;
  });
  return {
    completion: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, signal) => {
        resolve({ exitCode, signal, standardOutput, standardError });
      });
    }),
    interrupt: () => child.kill('SIGINT'),
  };
}

describe('standalone Agent Base CLI process', () => {
  it('streams through Pi and preserves Session history and replay across processes', async () => {
    const server = await startLoopbackServer();
    const configPath = await createConfig(server);

    const readiness = await runCli(['provider', 'check', '--config', configPath]).completion;
    expect(readiness.exitCode).toBe(0);
    expect(readiness.standardError).toBe('');
    expect(readiness.standardOutput).toContain('"status":"ready"');

    const first = await runCli([
      'run',
      '--config',
      configPath,
      '--message',
      'first turn',
      '--session-id',
      'durable-session',
      '--idempotency-key',
      'request-one',
    ]).completion;
    const second = await runCli([
      'run',
      '--config',
      configPath,
      '--message',
      'second turn',
      '--session-id',
      'durable-session',
      '--idempotency-key',
      'request-two',
    ]).completion;
    const replay = await runCli([
      'run',
      '--config',
      configPath,
      '--message',
      'second turn',
      '--session-id',
      'durable-session',
      '--idempotency-key',
      'request-two',
    ]).completion;

    expect(first).toMatchObject({ exitCode: 0, standardOutput: 'loopback response\n' });
    expect(second).toMatchObject({ exitCode: 0, standardOutput: 'loopback response\n' });
    expect(replay).toMatchObject({ exitCode: 0, standardOutput: 'loopback response\n' });
    expect(server.requests()).toHaveLength(2);
    expect(JSON.stringify(server.requests()[1])).toContain('first turn');
    expect(JSON.stringify(server.requests()[1])).toContain('loopback response');
    expect(JSON.stringify(server.requests()[1])).toContain('second turn');

    const inspection = await runCli([
      'session',
      'inspect',
      '--config',
      configPath,
      '--session-id',
      'durable-session',
    ]).completion;
    expect(inspection.exitCode).toBe(0);
    expect(inspection.standardError).toBe('');
    expect(inspection.standardOutput).toContain('"status":"inspected"');
  });

  it('maps SIGINT cancellation to exit 130 while a real Pi request is pending', async () => {
    const server = await startLoopbackServer(true);
    const configPath = await createConfig(server);
    const processRun = runCli([
      'run',
      '--config',
      configPath,
      '--message',
      'wait for cancellation',
      '--session-id',
      'cancel-session',
    ]);

    await server.waitForRequest();
    processRun.interrupt();

    await expect(processRun.completion).resolves.toMatchObject({
      exitCode: 130,
      signal: null,
    });
  });

  it('rejects invalid configuration without exposing its contents or path', async () => {
    const server = await startLoopbackServer();
    const configPath = await createConfig(server);
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        identity: { id: 'cli-agent' },
        provider: {
          kind: 'openai-compatible',
          reference: {
            provider: 'loopback',
            model: 'PRIVATE_MODEL_NAME',
            baseUrl: server.baseUrl,
          },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
        },
        persistence: { kind: 'memory' },
        privateUnknownField: 'PRIVATE_CONFIG_CONTENT',
      })
    );

    const result = await runCli(['provider', 'check', '--config', configPath]).completion;

    expect(result.exitCode).toBe(2);
    expect(result.standardOutput).toBe('');
    expect(result.standardError).toBe(
      'Agent Base CLI input rejected (STANDALONE_CONFIG_INVALID).\n'
    );
    expect(result.standardError).not.toContain(configPath);
    expect(result.standardError).not.toContain('PRIVATE');
    expect(server.requests()).toHaveLength(0);
  });
});
