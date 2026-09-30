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
          delta: { role: 'assistant', content, reasoning_content: 'PRIVATE_REASONING' },
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
        config: {
          kind: 'openai-compatible',
          reference: {
            provider: 'loopback',
            model: 'cli-test-model',
            baseUrl: server.baseUrl,
          },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning: false,
          compatibility: { supportsDeveloperRole: false },
        },
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: null,
          streamEventIdleTimeoutMilliseconds: null,
        },
      },
      persistence: { kind: 'sqlite', databasePath: join(directory, 'agent.sqlite') },
      mainActor: {
        invocationConfig: { temperature: 0, maxOutputTokens: 128 },
        invocationPolicy: { timeoutMilliseconds: null },
      },
      request: { timeoutMilliseconds: null },
      sessionCompaction: { timeoutMilliseconds: null },
    })
  );
  return configPath;
}

async function createManagedManifest(server: LoopbackServer): Promise<
  Readonly<{
    rootDirectory: string;
    manifestPath: string;
  }>
> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-base-managed-cli-'));
  temporaryDirectories.push(directory);
  const rootDirectory = join(directory, 'agents');
  const manifestPath = join(directory, 'create-agent.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      identity: { id: 'managed-agent', displayName: 'Managed Agent' },
      config: {
        provider: {
          config: {
            kind: 'openai-compatible',
            reference: {
              provider: 'loopback',
              model: 'cli-test-model',
              baseUrl: server.baseUrl,
            },
            contextWindowTokens: 8_192,
            maxOutputTokens: 1_024,
            supportsReasoning: false,
            compatibility: { supportsDeveloperRole: false },
          },
        },
        mainActor: { invocationConfig: { temperature: 0, maxOutputTokens: 128 } },
      },
    })
  );
  return Object.freeze({ rootDirectory, manifestPath });
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
  it('manages a directory-backed Agent lifecycle and opens it for provider execution', async () => {
    const server = await startLoopbackServer();
    const managed = await createManagedManifest(server);
    const created = await runCli([
      'agent',
      'create',
      '--root',
      managed.rootDirectory,
      '--manifest',
      managed.manifestPath,
    ]).completion;
    expect(created).toMatchObject({ exitCode: 0, standardError: '' });
    expect(JSON.parse(created.standardOutput) as unknown).toEqual({
      agentId: 'managed-agent',
      displayName: 'Managed Agent',
      status: 'active',
      identityRevision: 1,
      configRevision: 1,
      manifestProjection: 'current',
    });
    expect(created.standardOutput).not.toContain(server.baseUrl);

    const run = await runCli([
      'run',
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
      '--message',
      'hello managed Agent',
    ]).completion;
    expect(run).toMatchObject({ exitCode: 0, standardOutput: 'loopback response\n' });

    const disabled = await runCli([
      'agent',
      'disable',
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
      '--expected-revision',
      '1',
    ]).completion;
    expect(disabled.standardOutput).toContain('"status":"disabled"');
    const blocked = await runCli([
      'run',
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
      '--message',
      'blocked while disabled',
    ]).completion;
    expect(blocked).toMatchObject({
      exitCode: 1,
      standardOutput: '',
      standardError: 'Agent Base command failed (MANAGED_AGENT_DISABLED).\n',
    });

    const reactivated = await runCli([
      'agent',
      'reactivate',
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
      '--expected-revision',
      '2',
    ]).completion;
    expect(reactivated.standardOutput).toContain('"status":"active"');
    const listed = await runCli(['agent', 'list', '--root', managed.rootDirectory]).completion;
    expect(listed.standardOutput).toContain('"agentId":"managed-agent"');
  });

  it('manages the complete out-of-band Session lifecycle without opening a disabled Agent', async () => {
    const server = await startLoopbackServer();
    const managed = await createManagedManifest(server);
    await runCli([
      'agent',
      'create',
      '--root',
      managed.rootDirectory,
      '--manifest',
      managed.manifestPath,
    ]).completion;
    const run = await runCli([
      'run',
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
      '--message',
      'create lifecycle history',
    ]).completion;
    const opened: unknown = JSON.parse(run.standardError.trim());
    if (
      typeof opened !== 'object' ||
      opened === null ||
      !('sessionId' in opened) ||
      typeof opened.sessionId !== 'string'
    ) {
      throw new Error('Expected generated managed Session ID.');
    }
    const sessionId = opened.sessionId;
    await runCli([
      'agent',
      'disable',
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
      '--expected-revision',
      '1',
    ]).completion;
    const lifecycleScope = [
      '--root',
      managed.rootDirectory,
      '--agent-id',
      'managed-agent',
    ] as const;

    const active = await runCli(['session', 'lifecycle', 'list', ...lifecycleScope, '--limit', '1'])
      .completion;
    expect(active).toMatchObject({ exitCode: 0, standardError: '' });
    expect(JSON.parse(active.standardOutput) as unknown).toMatchObject({
      records: [{ sessionId, status: 'active' }],
    });

    const inspected = await runCli([
      'session',
      'lifecycle',
      'inspect',
      ...lifecycleScope,
      '--session-id',
      sessionId,
    ]).completion;
    const inspection: unknown = JSON.parse(inspected.standardOutput);
    if (
      typeof inspection !== 'object' ||
      inspection === null ||
      !('metadataRevision' in inspection) ||
      typeof inspection.metadataRevision !== 'number' ||
      !('execution' in inspection) ||
      typeof inspection.execution !== 'object' ||
      inspection.execution === null ||
      !('revision' in inspection.execution) ||
      typeof inspection.execution.revision !== 'number'
    ) {
      throw new Error('Expected lifecycle inspection revisions.');
    }
    expect(inspection.metadataRevision).toBe(0);

    const turns = await runCli([
      'session',
      'lifecycle',
      'turns',
      ...lifecycleScope,
      '--session-id',
      sessionId,
      '--limit',
      '1',
    ]).completion;
    expect(JSON.parse(turns.standardOutput) as unknown).toMatchObject({
      records: [{ status: 'completed', userMessage: { text: 'create lifecycle history' } }],
    });

    const recovered = await runCli([
      'session',
      'lifecycle',
      'recover',
      ...lifecycleScope,
      '--session-id',
      sessionId,
      '--expected-execution-revision',
      String(inspection.execution.revision),
    ]).completion;
    expect(JSON.parse(recovered.standardOutput) as unknown).toMatchObject({
      state: 'ready',
      activeLeaseCount: 0,
      pendingWorkCount: 0,
    });

    const retired = await runCli([
      'session',
      'lifecycle',
      'retire',
      ...lifecycleScope,
      '--session-id',
      sessionId,
      '--expected-revision',
      String(inspection.metadataRevision),
    ]).completion;
    expect(JSON.parse(retired.standardOutput) as unknown).toMatchObject({
      sessionId,
      status: 'retired',
      metadataRevision: 1,
    });

    const retiredList = await runCli(['session', 'lifecycle', 'list-retired', ...lifecycleScope])
      .completion;
    expect(JSON.parse(retiredList.standardOutput) as unknown).toMatchObject({
      records: [{ sessionId, status: 'retired' }],
    });

    const restored = await runCli([
      'session',
      'lifecycle',
      'restore',
      ...lifecycleScope,
      '--session-id',
      sessionId,
      '--expected-revision',
      '1',
    ]).completion;
    expect(JSON.parse(restored.standardOutput) as unknown).toMatchObject({
      sessionId,
      status: 'active',
      metadataRevision: 2,
    });
    await runCli([
      'session',
      'lifecycle',
      'retire',
      ...lifecycleScope,
      '--session-id',
      sessionId,
      '--expected-revision',
      '2',
    ]).completion;

    const purged = await runCli([
      'session',
      'lifecycle',
      'purge',
      ...lifecycleScope,
      '--session-id',
      sessionId,
      '--expected-revision',
      '3',
      '--confirm-permanent-delete',
    ]).completion;
    expect(JSON.parse(purged.standardOutput) as unknown).toEqual({
      status: 'purged',
      agentId: 'managed-agent',
      sessionId,
    });
    const missing = await runCli([
      'session',
      'lifecycle',
      'inspect',
      ...lifecycleScope,
      '--session-id',
      sessionId,
    ]).completion;
    expect(missing.standardOutput).toBe('null\n');
    expect(server.requests()).toHaveLength(1);
  });

  it('streams through Pi and preserves Session history and replay across processes', async () => {
    const server = await startLoopbackServer();
    const configPath = await createConfig(server);

    const readiness = await runCli(['provider', 'check', '--config', configPath]).completion;
    expect(readiness.exitCode).toBe(0);
    expect(readiness.standardError).toBe('');
    expect(readiness.standardOutput).toContain('"status":"ready"');

    const first = await runCli(['run', '--config', configPath, '--message', 'first turn'])
      .completion;
    const created: unknown = JSON.parse(first.standardError.trim());
    if (
      typeof created !== 'object' ||
      created === null ||
      !('sessionId' in created) ||
      typeof created.sessionId !== 'string'
    ) {
      throw new Error('Expected generated Session ID on stderr.');
    }
    const sessionId = created.sessionId;
    const second = await runCli([
      'run',
      '--config',
      configPath,
      '--message',
      'second turn',
      '--session-id',
      sessionId,
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
      sessionId,
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
      sessionId,
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
          config: {
            kind: 'openai-compatible',
            reference: {
              provider: 'loopback',
              model: 'PRIVATE_MODEL_NAME',
              baseUrl: server.baseUrl,
            },
            contextWindowTokens: 8_192,
            maxOutputTokens: 1_024,
            supportsReasoning: false,
            compatibility: { supportsDeveloperRole: false },
          },
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
