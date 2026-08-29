import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as fileConstants } from 'node:fs';
import { access, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JsonValue } from '@ta-agent/workbench-domain';
import {
  ExecutionStatus,
  parseExecutionObservation,
  type ExecutionTerminal,
} from '@ta-agent/workbench-extension';

import { parseLocalCommandLaunchRecord } from '../command-bridge/command-configuration.js';
import {
  parseLocalCommandProtocolMessage,
  parseLocalCommandTerminal,
  progressMessageToObservation,
} from '../command-bridge/protocol.js';
import {
  LOCAL_EXECUTION_CANCELLATION_FILE,
  LOCAL_EXECUTION_LAUNCH_FILE,
  LOCAL_EXECUTION_OBSERVATION_FILE,
  LOCAL_EXECUTION_REQUEST_FILE,
  LOCAL_EXECUTION_STDERR_FILE,
  LOCAL_EXECUTION_SUPERVISOR_READY_FILE,
  LocalCommandProtocolMessageKind,
  MAXIMUM_LOCAL_COMMAND_REQUEST_BYTES,
} from '../foundation/constants.js';
import { writeLocalExecutionObservation } from '../execution/execution-files.js';
import { BoundedLineDecoder } from './bounded-line-decoder.js';
import {
  claimSupervisor,
  startSupervisorHeartbeat,
  SupervisorClaimKind,
} from './supervisor-record.js';

export async function runLocalSupervisor(executionDirectory: string): Promise<void> {
  if (await executionIsTerminal(executionDirectory)) return;
  const claim = await claimSupervisor(executionDirectory);
  if (claim.kind === SupervisorClaimKind.ActiveOwner) return;
  if (claim.kind === SupervisorClaimKind.StaleOwner) {
    if (await executionIsTerminal(executionDirectory)) return;
    await publishFailure(
      executionDirectory,
      ExecutionStatus.Lost,
      'LOCAL_SUPERVISOR_LOST',
      'The local supervisor stopped before publishing a terminal result.',
      true
    );
    await markReady(executionDirectory);
    return;
  }

  const stopHeartbeat = startSupervisorHeartbeat(executionDirectory, claim.ownership);
  try {
    if (await cancellationFileExists(executionDirectory)) {
      await writeLocalExecutionObservation(executionDirectory, {
        status: ExecutionStatus.Cancelled,
        reason: { code: 'LOCAL_CANCELLATION_REQUESTED' },
      });
      await markReady(executionDirectory);
      return;
    }
    const launch = parseLocalCommandLaunchRecord(
      JSON.parse(await readFile(join(executionDirectory, LOCAL_EXECUTION_LAUNCH_FILE), 'utf8'))
    );
    const requestBytes = await readBoundedRequest(executionDirectory);
    const child = spawn(launch.executable, launch.arguments, {
      cwd: launch.workingDirectory,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const spawned = waitForSpawn(child);
    const stderr = captureStderr(
      child,
      join(executionDirectory, LOCAL_EXECUTION_STDERR_FILE),
      launch.maximumStderrBytes
    );
    await spawned;
    await markReady(executionDirectory);
    child.stdin.end(requestBytes);
    await superviseChild(executionDirectory, child, launch, stderr);
  } catch (cause: unknown) {
    await publishFailure(
      executionDirectory,
      ExecutionStatus.Failed,
      'LOCAL_SUPERVISOR_ERROR',
      errorMessage(cause),
      true
    );
    await markReady(executionDirectory).catch(() => undefined);
  } finally {
    stopHeartbeat();
  }
}

async function executionIsTerminal(executionDirectory: string): Promise<boolean> {
  const input = JSON.parse(
    await readFile(join(executionDirectory, LOCAL_EXECUTION_OBSERVATION_FILE), 'utf8')
  ) as unknown;
  return parseExecutionObservation(input).status !== ExecutionStatus.Running;
}

async function superviseChild(
  executionDirectory: string,
  child: ChildProcessWithoutNullStreams,
  launch: ReturnType<typeof parseLocalCommandLaunchRecord>,
  stderrCapture: Promise<void>
): Promise<void> {
  const decoder = new BoundedLineDecoder(launch.maximumProtocolMessageBytes);
  const exitPromise = waitForExit(child);
  let terminal: ExecutionTerminal<JsonValue> | undefined;
  let protocolFailure: Error | undefined;
  let cancellationRequested = false;
  let killTimer: NodeJS.Timeout | undefined;

  const cancellationTimer = setInterval(() => {
    void cancellationFileExists(executionDirectory).then((exists) => {
      if (!exists || cancellationRequested) return;
      cancellationRequested = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), launch.cancellationGraceMilliseconds);
    });
  }, launch.cancellationPollMilliseconds);

  const processLine = async (line: string): Promise<void> => {
    if (line.length === 0) return;
    if (terminal !== undefined) throw new Error('Received protocol data after terminal result.');
    const message = parseLocalCommandProtocolMessage(JSON.parse(line) as unknown);
    if (message.kind === LocalCommandProtocolMessageKind.Progress) {
      await writeLocalExecutionObservation(
        executionDirectory,
        progressMessageToObservation(message)
      );
      return;
    }
    terminal = parseLocalCommandTerminal(message.terminal);
  };

  try {
    for await (const chunk of child.stdout) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Expected backend stdout bytes.');
      for (const line of decoder.push(chunk)) await processLine(line);
    }
    for (const line of decoder.finish()) await processLine(line);
  } catch (cause: unknown) {
    protocolFailure = cause instanceof Error ? cause : new Error(String(cause));
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), launch.cancellationGraceMilliseconds);
  }

  const exit = await exitPromise;
  clearInterval(cancellationTimer);
  if (killTimer !== undefined) clearTimeout(killTimer);
  await stderrCapture;

  if (cancellationRequested) {
    await writeLocalExecutionObservation(executionDirectory, {
      status: ExecutionStatus.Cancelled,
      reason: { code: 'LOCAL_CANCELLATION_REQUESTED' },
    });
    return;
  }
  if (protocolFailure !== undefined) {
    await publishFailure(
      executionDirectory,
      ExecutionStatus.Failed,
      'LOCAL_COMMAND_PROTOCOL_ERROR',
      protocolFailure.message,
      false
    );
    return;
  }
  if (terminal === undefined) {
    await publishFailure(
      executionDirectory,
      ExecutionStatus.Failed,
      'LOCAL_COMMAND_MISSING_TERMINAL',
      `Backend exited without a terminal result (${describeExit(exit)}).`,
      false
    );
    return;
  }
  if (terminal.status === ExecutionStatus.Succeeded && exit.code !== 0) {
    await publishFailure(
      executionDirectory,
      ExecutionStatus.Failed,
      'LOCAL_COMMAND_EXIT_NON_ZERO',
      `Backend reported success but ${describeExit(exit)}.`,
      false
    );
    return;
  }
  await writeLocalExecutionObservation(executionDirectory, terminal);
}

async function readBoundedRequest(executionDirectory: string): Promise<Buffer> {
  const bytes = await readFile(join(executionDirectory, LOCAL_EXECUTION_REQUEST_FILE));
  if (bytes.byteLength > MAXIMUM_LOCAL_COMMAND_REQUEST_BYTES) {
    throw new Error('Local command request exceeds its byte limit.');
  }
  JSON.parse(bytes.toString('utf8')) as unknown;
  return bytes;
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function captureStderr(
  child: ChildProcessWithoutNullStreams,
  path: string,
  maximumBytes: number
): Promise<void> {
  const handle = await open(
    path,
    fileConstants.O_WRONLY |
      fileConstants.O_CREAT |
      fileConstants.O_TRUNC |
      fileConstants.O_NOFOLLOW,
    0o600
  );
  let written = 0;
  try {
    for await (const chunk of child.stderr) {
      if (!Buffer.isBuffer(chunk) || written >= maximumBytes) continue;
      const selected = chunk.subarray(0, maximumBytes - written);
      await handle.write(selected);
      written += selected.byteLength;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function cancellationFileExists(executionDirectory: string): Promise<boolean> {
  try {
    await access(join(executionDirectory, LOCAL_EXECUTION_CANCELLATION_FILE), fileConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function markReady(executionDirectory: string): Promise<void> {
  const path = join(executionDirectory, LOCAL_EXECUTION_SUPERVISOR_READY_FILE);
  try {
    const handle = await open(
      path,
      fileConstants.O_WRONLY |
        fileConstants.O_CREAT |
        fileConstants.O_EXCL |
        fileConstants.O_NOFOLLOW,
      0o600
    );
    await handle.close();
  } catch (cause: unknown) {
    if (!isNodeError(cause) || cause.code !== 'EEXIST') throw cause;
  }
}

async function publishFailure(
  executionDirectory: string,
  status: typeof ExecutionStatus.Failed | typeof ExecutionStatus.Lost,
  code: string,
  message: string,
  retryable: boolean
): Promise<void> {
  await writeLocalExecutionObservation(executionDirectory, {
    status,
    failure: { code, message: message.slice(0, 2_000) || code, retryable },
  });
}

function describeExit(exit: {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}): string {
  if (exit.signal !== null) return `was terminated by ${exit.signal}`;
  return `exited with code ${String(exit.code)}`;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return 'The local supervisor failed.';
}

function isNodeError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && 'code' in cause;
}
