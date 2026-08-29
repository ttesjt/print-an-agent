import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseProfileId } from '@ta-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  ExecutionStatus,
  type ExecutionObservation,
} from '@ta-agent/workbench-extension';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalCommandBridge,
  createLocalExecutionSupport,
  LocalCommandWorkspaceConflictError,
} from '../../src/index.js';

const backendSource = `
import { appendFile } from 'node:fs/promises';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const fixture = request.input?.fixture ?? {};
if (typeof fixture.counterPath === 'string') await appendFile(fixture.counterPath, 'started\\n');
if (typeof fixture.stderr === 'string') process.stderr.write(fixture.stderr);
if (fixture.malformed === true) {
  process.stdout.write('{malformed\\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify({ kind: 'progress', progress: { phase: 'running' } }) + '\\n');
if (typeof fixture.delayMilliseconds === 'number') {
  await new Promise((resolve) => setTimeout(resolve, fixture.delayMilliseconds));
}
if (fixture.omitTerminal !== true) {
  process.stdout.write(JSON.stringify({
    kind: 'terminal',
    terminal: { status: 'succeeded', result: fixture.result ?? { value: 'ok' } },
  }) + '\\n');
}
`;
const directories: string[] = [];
const profileId = parseProfileId('profile-command');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('local command bridge', () => {
  it('detaches a backend and exposes its progress and terminal result through Execution Support', async () => {
    const rootDirectory = await temporaryDirectory();
    const bridge = createBridge(rootDirectory);
    const support = createSupport(rootDirectory);

    const dispatch = await bridge.dispatch({
      profileId,
      runId: 'run-command-1',
      input: { fixture: { delayMilliseconds: 50, result: { answer: 42 } } },
    });

    expect(dispatch.kind).toBe(CapabilityDispatchKind.Accepted);
    const terminal = await observeUntilTerminal(support, dispatch.executionReceipt);
    expect(terminal).toEqual({
      status: ExecutionStatus.Succeeded,
      result: { answer: 42 },
    });
  });

  it('uses Profile and Run identity as an idempotent submission key', async () => {
    const rootDirectory = await temporaryDirectory();
    const counterPath = join(rootDirectory, 'counter.txt');
    const bridge = createBridge(rootDirectory);
    const request = {
      profileId,
      runId: 'run-command-idempotent',
      input: { fixture: { counterPath, delayMilliseconds: 100 } },
    };

    const [first, second] = await Promise.all([bridge.dispatch(request), bridge.dispatch(request)]);
    expect(second.executionReceipt).toEqual(first.executionReceipt);
    await observeUntilTerminal(createSupport(rootDirectory), first.executionReceipt);
    await expect(readFile(counterPath, 'utf8')).resolves.toBe('started\n');

    const afterCompletion = await bridge.dispatch(request);
    expect(afterCompletion.executionReceipt).toEqual(first.executionReceipt);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      createSupport(rootDirectory).observe({
        profileId,
        executionReceipt: first.executionReceipt,
      })
    ).resolves.toMatchObject({ status: ExecutionStatus.Succeeded });
    await expect(readFile(counterPath, 'utf8')).resolves.toBe('started\n');
  });

  it('rejects reuse of a Run identity with a different request', async () => {
    const rootDirectory = await temporaryDirectory();
    const bridge = createBridge(rootDirectory);
    const first = await bridge.dispatch({
      profileId,
      runId: 'run-command-conflict',
      input: { value: 1 },
    });

    await expect(
      bridge.dispatch({ profileId, runId: 'run-command-conflict', input: { value: 2 } })
    ).rejects.toBeInstanceOf(LocalCommandWorkspaceConflictError);
    await observeUntilTerminal(createSupport(rootDirectory), first.executionReceipt);
  });

  it('rejects redispatch when the inherited execution environment has changed', async () => {
    const rootDirectory = await temporaryDirectory();
    const environmentKey = 'WORKBENCH_LOCAL_COMMAND_TEST_ENVIRONMENT';
    const previous = process.env[environmentKey];
    process.env[environmentKey] = 'first';
    const firstBridge = createBridge(rootDirectory);
    const request = {
      profileId,
      runId: 'run-command-environment',
      input: { fixture: { delayMilliseconds: 50 } },
    };
    const first = await firstBridge.dispatch(request);
    process.env[environmentKey] = 'second';
    const secondBridge = createBridge(rootDirectory);

    try {
      await expect(secondBridge.dispatch(request)).rejects.toBeInstanceOf(
        LocalCommandWorkspaceConflictError
      );
      await observeUntilTerminal(createSupport(rootDirectory), first.executionReceipt);
    } finally {
      if (previous === undefined) delete process.env[environmentKey];
      else process.env[environmentKey] = previous;
    }
  });

  it('turns the durable cancellation marker into a cancelled terminal observation', async () => {
    const rootDirectory = await temporaryDirectory();
    const bridge = createBridge(rootDirectory);
    const support = createSupport(rootDirectory);
    const dispatch = await bridge.dispatch({
      profileId,
      runId: 'run-command-cancel',
      input: { fixture: { delayMilliseconds: 5_000 } },
    });

    await support.cancel({ profileId, executionReceipt: dispatch.executionReceipt });

    await expect(observeUntilTerminal(support, dispatch.executionReceipt)).resolves.toMatchObject({
      status: ExecutionStatus.Cancelled,
    });
  });

  it('publishes malformed backend output as a structured execution failure', async () => {
    const rootDirectory = await temporaryDirectory();
    const bridge = createBridge(rootDirectory);
    const support = createSupport(rootDirectory);
    const dispatch = await bridge.dispatch({
      profileId,
      runId: 'run-command-malformed',
      input: { fixture: { malformed: true } },
    });

    await expect(observeUntilTerminal(support, dispatch.executionReceipt)).resolves.toMatchObject({
      status: ExecutionStatus.Failed,
      failure: { code: 'LOCAL_COMMAND_PROTOCOL_ERROR', retryable: false },
    });
  });
});

function createBridge(rootDirectory: string) {
  return createLocalCommandBridge({
    rootDirectory,
    command: {
      executable: process.execPath,
      arguments: ['--input-type=module', '--eval', backendSource],
    },
    cancellationGraceMilliseconds: 50,
    cancellationPollMilliseconds: 10,
  });
}

function createSupport(rootDirectory: string) {
  return createLocalExecutionSupport({
    runtimeSupportId: 'local-execution',
    rootDirectory,
  });
}

async function observeUntilTerminal(
  support: ReturnType<typeof createSupport>,
  executionReceipt: Parameters<ReturnType<typeof createSupport>['observe']>[0]['executionReceipt']
): Promise<Exclude<ExecutionObservation<unknown>, { readonly status: 'running' }>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const observation = await support.observe({ profileId, executionReceipt });
    if (observation.status !== ExecutionStatus.Running) return observation;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Local execution did not become terminal.');
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-local-command-'));
  directories.push(directory);
  return directory;
}
