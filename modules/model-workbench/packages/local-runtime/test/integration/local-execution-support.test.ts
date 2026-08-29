import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseProfileId } from '@ta-agent/workbench-domain';
import { ExecutionStatus } from '@ta-agent/workbench-extension';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalExecutionSupport,
  defineLocalExecutionReceipt,
  LOCAL_EXECUTION_CANCELLATION_FILE,
  LOCAL_EXECUTION_OBSERVATION_FILE,
  MAXIMUM_EXECUTION_OBSERVATION_BYTES,
  LocalExecutionObservationError,
} from '../../src/index.js';

const directories: string[] = [];
const profileId = parseProfileId('profile-local');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('local Execution Support', () => {
  it('observes running progress and a later terminal result from the durable execution record', async () => {
    const rootDirectory = await temporaryDirectory();
    const executionDirectory = await createExecutionDirectory(
      rootDirectory,
      profileId,
      'execution-1'
    );
    const support = createLocalExecutionSupport({
      runtimeSupportId: 'local-execution',
      rootDirectory,
    });
    const executionReceipt = defineLocalExecutionReceipt({ executionId: 'execution-1' });
    await writeObservation(executionDirectory, {
      status: ExecutionStatus.Running,
      progress: { completed: 2, total: 5 },
    });

    await expect(support.observe({ profileId, executionReceipt })).resolves.toEqual({
      status: ExecutionStatus.Running,
      progress: { completed: 2, total: 5 },
    });

    await writeObservation(executionDirectory, {
      status: ExecutionStatus.Succeeded,
      result: { artifact: { digest: `sha256:${'a'.repeat(64)}`, receipt: { key: 'result' } } },
    });
    await expect(support.observe({ profileId, executionReceipt })).resolves.toEqual({
      status: ExecutionStatus.Succeeded,
      result: { artifact: { digest: `sha256:${'a'.repeat(64)}`, receipt: { key: 'result' } } },
    });
  });

  it('persists an idempotent cancellation request for the local supervisor', async () => {
    const rootDirectory = await temporaryDirectory();
    const executionDirectory = await createExecutionDirectory(
      rootDirectory,
      profileId,
      'execution-2'
    );
    const support = createLocalExecutionSupport({
      runtimeSupportId: 'local-execution',
      rootDirectory,
    });
    const executionReceipt = defineLocalExecutionReceipt({ executionId: 'execution-2' });

    await support.cancel({ profileId, executionReceipt });
    await support.cancel({ profileId, executionReceipt });

    await expect(
      readFile(join(executionDirectory, LOCAL_EXECUTION_CANCELLATION_FILE), 'utf8')
    ).resolves.toBe('');
  });

  it('rejects missing or malformed execution records instead of inventing terminal state', async () => {
    const rootDirectory = await temporaryDirectory();
    const support = createLocalExecutionSupport({
      runtimeSupportId: 'local-execution',
      rootDirectory,
    });
    const missingReceipt = defineLocalExecutionReceipt({ executionId: 'execution-missing' });
    await expect(
      support.observe({ profileId, executionReceipt: missingReceipt })
    ).rejects.toBeInstanceOf(LocalExecutionObservationError);

    const executionDirectory = await createExecutionDirectory(
      rootDirectory,
      profileId,
      'execution-bad'
    );
    await writeFile(
      join(executionDirectory, LOCAL_EXECUTION_OBSERVATION_FILE),
      '{bad-json',
      'utf8'
    );
    const malformedReceipt = defineLocalExecutionReceipt({ executionId: 'execution-bad' });
    await expect(
      support.observe({ profileId, executionReceipt: malformedReceipt })
    ).rejects.toBeInstanceOf(LocalExecutionObservationError);
  });

  it('keeps equal local execution receipts isolated by Profile', async () => {
    const rootDirectory = await temporaryDirectory();
    const executionDirectory = await createExecutionDirectory(
      rootDirectory,
      profileId,
      'execution-shared'
    );
    await writeObservation(executionDirectory, { status: ExecutionStatus.Running });
    const support = createLocalExecutionSupport({
      runtimeSupportId: 'local-execution',
      rootDirectory,
    });
    const executionReceipt = defineLocalExecutionReceipt({ executionId: 'execution-shared' });

    await expect(
      support.observe({ profileId: parseProfileId('profile-other'), executionReceipt })
    ).rejects.toBeInstanceOf(LocalExecutionObservationError);
  });

  it('enforces the observation byte limit while reading the file', async () => {
    const rootDirectory = await temporaryDirectory();
    const executionDirectory = await createExecutionDirectory(
      rootDirectory,
      profileId,
      'execution-oversized'
    );
    await writeFile(
      join(executionDirectory, LOCAL_EXECUTION_OBSERVATION_FILE),
      Buffer.alloc(MAXIMUM_EXECUTION_OBSERVATION_BYTES + 1, 0x20)
    );
    const support = createLocalExecutionSupport({
      runtimeSupportId: 'local-execution',
      rootDirectory,
    });

    await expect(
      support.observe({
        profileId,
        executionReceipt: defineLocalExecutionReceipt({ executionId: 'execution-oversized' }),
      })
    ).rejects.toBeInstanceOf(LocalExecutionObservationError);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-local-execution-'));
  directories.push(directory);
  return directory;
}

async function createExecutionDirectory(
  rootDirectory: string,
  ownerProfileId: string,
  executionId: string
): Promise<string> {
  const directory = join(rootDirectory, ownerProfileId, 'executions', executionId);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function writeObservation(directory: string, observation: unknown): Promise<void> {
  await writeFile(
    join(directory, LOCAL_EXECUTION_OBSERVATION_FILE),
    `${JSON.stringify(observation)}\n`,
    'utf8'
  );
}
