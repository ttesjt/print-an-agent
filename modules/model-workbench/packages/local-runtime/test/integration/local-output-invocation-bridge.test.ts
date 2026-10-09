import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OutputInvocationKind } from '@ta-agent/workbench-extension';
import { describe, expect, it } from 'vitest';

import { LocalOutputInvocationError, createLocalOutputInvocationBridge } from '../../src/index.js';

const fixture = String.raw`
  import { appendFile } from 'node:fs/promises';
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (typeof request.terminationMarker === 'string') {
    process.once('SIGTERM', () => {
      void appendFile(request.terminationMarker, 'terminated\\n').finally(() => process.exit(0));
    });
  }
  if (request.mode === 'completed') {
    console.log(JSON.stringify({ kind: 'completed', result: request.result }));
  } else if (request.mode === 'stream') {
    console.log(JSON.stringify({ kind: 'stream-start' }));
    for (const result of request.results) console.log(JSON.stringify({ kind: 'chunk', result }));
  } else if (request.mode === 'stream-error') {
    console.log(JSON.stringify({ kind: 'stream-start' }));
    console.log(JSON.stringify({ kind: 'chunk', result: 'first' }));
    process.stderr.write('fixture stream failed');
    process.exitCode = 7;
  } else if (request.mode === 'long-stream') {
    console.log(JSON.stringify({ kind: 'stream-start' }));
    console.log(JSON.stringify({ kind: 'chunk', result: 'first' }));
    setInterval(() => console.log(JSON.stringify({ kind: 'chunk', result: 'later' })), 1000);
  } else if (request.mode === 'invalid-first') {
    console.log('{"kind":"unknown"}');
    setInterval(() => undefined, 1000);
  } else if (request.mode === 'wait') {
    setInterval(() => undefined, 1000);
  } else {
    console.log('{"kind":"unknown"}');
  }
`;

describe('createLocalOutputInvocationBridge', () => {
  const bridge = createLocalOutputInvocationBridge({
    command: {
      executable: process.execPath,
      arguments: ['--input-type=module', '--eval', fixture],
    },
    cancellationGraceMilliseconds: 100,
  });

  it('returns one completed JSON result', async () => {
    await expect(bridge.invoke({ mode: 'completed', result: { text: 'hello' } })).resolves.toEqual({
      kind: OutputInvocationKind.Completed,
      result: { text: 'hello' },
    });
  });

  it('streams validated JSON chunks', async () => {
    const invocation = await bridge.invoke({ mode: 'stream', results: ['a', { text: 'b' }] });
    expect(invocation.kind).toBe(OutputInvocationKind.Streaming);
    if (invocation.kind !== OutputInvocationKind.Streaming) return;
    const chunks = [];
    for await (const chunk of invocation.stream) chunks.push(chunk);
    expect(chunks).toEqual(['a', { text: 'b' }]);
  });

  it('reports a backend failure that occurs after streaming starts', async () => {
    const invocation = await bridge.invoke({ mode: 'stream-error' });
    if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
    const consume = async (): Promise<void> => {
      for await (const chunk of invocation.stream) {
        expect(chunk).toBe('first');
      }
    };
    await expect(consume()).rejects.toMatchObject({
      name: LocalOutputInvocationError.name,
      code: 'LOCAL_OUTPUT_INVOCATION_FAILED',
    });
  });

  it('terminates the backend when a consumer stops reading early', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-output-invocation-'));
    const marker = join(directory, 'terminated');
    try {
      const invocation = await bridge.invoke({ mode: 'long-stream', terminationMarker: marker });
      if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
      for await (const chunk of invocation.stream) {
        expect(chunk).toBe('first');
        break;
      }
      await expectEventually(() => access(marker));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('terminates an already running backend before the first stream pull, exactly once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-output-invocation-'));
    const marker = join(directory, 'terminated');
    let iterator: AsyncIterator<unknown> | undefined;
    try {
      const invocation = await bridge.invoke({ mode: 'long-stream', terminationMarker: marker });
      if (invocation.kind !== OutputInvocationKind.Streaming) throw new Error('Expected a stream.');
      iterator = invocation.stream[Symbol.asyncIterator]();
      await Promise.all([iterator.return?.(), iterator.return?.()]);
      await expectEventually(() => access(marker));
      expect(await readFile(marker, 'utf8')).toBe('terminated\\n');
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
    } finally {
      await iterator?.return?.();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('closes the reader and process when the invocation handshake is rejected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-output-invocation-'));
    const marker = join(directory, 'terminated');
    try {
      await expect(
        bridge.invoke({ mode: 'invalid-first', terminationMarker: marker })
      ).rejects.toBeInstanceOf(LocalOutputInvocationError);
      await expectEventually(() => access(marker));
      expect(await readFile(marker, 'utf8')).toBe('terminated\\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('aborts a running invocation process', async () => {
    const controller = new AbortController();
    const pending = bridge.invoke({ mode: 'wait' }, { signal: controller.signal });
    setTimeout(() => controller.abort('test abort'), 25);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports a request pipe failure when the backend closes stdin', async () => {
    const closedInputBridge = createLocalOutputInvocationBridge({
      command: {
        executable: process.execPath,
        arguments: [
          '--input-type=module',
          '--eval',
          "import { closeSync } from 'node:fs'; closeSync(0); setTimeout(() => undefined, 100);",
        ],
      },
      cancellationGraceMilliseconds: 100,
    });

    await expect(
      closedInputBridge.invoke({ payload: 'x'.repeat(1024 * 1024) })
    ).rejects.toMatchObject({
      name: LocalOutputInvocationError.name,
      code: 'LOCAL_OUTPUT_INVOCATION_FAILED',
    });
  });
});

async function expectEventually(assertion: () => Promise<unknown>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }
  await assertion();
}
