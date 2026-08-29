import { constants as fileConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { JsonValue, ProfileId } from '@ta-agent/workbench-domain';
import {
  parseExecutionObservation,
  type ExecutionObservation,
} from '@ta-agent/workbench-extension';

import {
  LOCAL_EXECUTION_CANCELLATION_FILE,
  LOCAL_EXECUTION_OBSERVATION_FILE,
  MAXIMUM_EXECUTION_OBSERVATION_BYTES,
} from '../foundation/constants.js';
import {
  LocalExecutionCancellationError,
  LocalExecutionObservationError,
} from '../foundation/errors.js';
import {
  assertStableExistingDirectory,
  ensureStableDirectory,
  isNodeError,
} from '../foundation/paths.js';
import type { LocalFilesystemExecutionReceipt } from './contracts.js';

export async function readLocalExecutionObservation(
  rootDirectory: string,
  profileId: ProfileId,
  receipt: LocalFilesystemExecutionReceipt,
  signal?: AbortSignal
): Promise<ExecutionObservation<JsonValue>> {
  assertNotAborted(signal, 'Local execution observation was aborted.');
  let executionDirectory: string;
  try {
    executionDirectory = await resolveExecutionDirectory(rootDirectory, profileId, receipt);
  } catch (cause: unknown) {
    throw new LocalExecutionObservationError(
      `Local execution "${receipt.executionId}" is not available.`,
      { cause }
    );
  }
  const observationPath = join(executionDirectory, LOCAL_EXECUTION_OBSERVATION_FILE);
  try {
    const bytes = await readBoundedFile(observationPath, signal);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return parseExecutionObservation(value, 'localExecution.observation');
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new LocalExecutionObservationError(
      `Could not read local execution "${receipt.executionId}" observation.`,
      { cause }
    );
  }
}

export async function requestLocalExecutionCancellation(
  rootDirectory: string,
  profileId: ProfileId,
  receipt: LocalFilesystemExecutionReceipt,
  signal?: AbortSignal
): Promise<void> {
  assertNotAborted(signal, 'Local execution cancellation was aborted.');
  try {
    const executionDirectory = await resolveExecutionDirectory(rootDirectory, profileId, receipt);
    const cancellationPath = join(executionDirectory, LOCAL_EXECUTION_CANCELLATION_FILE);
    assertNotAborted(signal, 'Local execution cancellation was aborted.');
    let handle;
    try {
      handle = await open(
        cancellationPath,
        fileConstants.O_WRONLY |
          fileConstants.O_CREAT |
          fileConstants.O_EXCL |
          fileConstants.O_NOFOLLOW,
        0o600
      );
    } catch (cause: unknown) {
      if (isNodeError(cause) && cause.code === 'EEXIST') return;
      throw cause;
    }
    await handle.close();
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new LocalExecutionCancellationError(
      `Could not request cancellation for local execution "${receipt.executionId}".`,
      { cause }
    );
  }
}

export async function writeLocalExecutionObservation(
  executionDirectory: string,
  input: unknown
): Promise<ExecutionObservation<JsonValue>> {
  const observation = parseExecutionObservation(input, 'localExecution.observation');
  const bytes = Buffer.from(`${JSON.stringify(observation)}\n`, 'utf8');
  if (bytes.byteLength > MAXIMUM_EXECUTION_OBSERVATION_BYTES) {
    throw new LocalExecutionObservationError('Local execution observation exceeds its byte limit.');
  }
  const targetPath = join(executionDirectory, LOCAL_EXECUTION_OBSERVATION_FILE);
  const temporaryPath = join(
    executionDirectory,
    `.${LOCAL_EXECUTION_OBSERVATION_FILE}.${String(process.pid)}.${randomUUID()}.tmp`
  );
  let handle;
  try {
    handle = await open(
      temporaryPath,
      fileConstants.O_WRONLY |
        fileConstants.O_CREAT |
        fileConstants.O_EXCL |
        fileConstants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
    return observation;
  } catch (cause: unknown) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (cause instanceof LocalExecutionObservationError) throw cause;
    throw new LocalExecutionObservationError('Could not publish local execution observation.', {
      cause,
    });
  }
}

async function resolveExecutionDirectory(
  rootDirectory: string,
  profileId: ProfileId,
  receipt: LocalFilesystemExecutionReceipt
): Promise<string> {
  const canonicalRoot = await ensureStableDirectory(rootDirectory);
  const profileRoot = join(canonicalRoot, profileId);
  await assertStableExistingDirectory(profileRoot);
  const executionsRoot = join(profileRoot, 'executions');
  await assertStableExistingDirectory(executionsRoot);
  const executionDirectory = join(executionsRoot, receipt.executionId);
  await assertStableExistingDirectory(executionDirectory);
  return executionDirectory;
}

async function readBoundedFile(path: string, signal?: AbortSignal): Promise<Buffer> {
  const handle = await open(
    path,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_NONBLOCK
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAXIMUM_EXECUTION_OBSERVATION_BYTES) {
      throw new Error('Local execution observation must be a bounded regular file.');
    }
    const chunks: Buffer[] = [];
    let observedBytes = 0;
    while (true) {
      assertNotAborted(signal, 'Local execution observation was aborted.');
      const remaining = MAXIMUM_EXECUTION_OBSERVATION_BYTES + 1 - observedBytes;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      assertNotAborted(signal, 'Local execution observation was aborted.');
      if (bytesRead === 0) break;
      observedBytes += bytesRead;
      if (observedBytes > MAXIMUM_EXECUTION_OBSERVATION_BYTES) {
        throw new Error('Local execution observation exceeds its byte limit.');
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, observedBytes);
  } finally {
    await handle.close();
  }
}

function assertNotAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted !== true) return;
  const error = new Error(message, { cause: signal.reason });
  error.name = 'AbortError';
  throw error;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
