import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  canonicalJson,
  parseJsonValue,
  parseProfileId,
  parseRunId,
  type JsonObject,
  type JsonValue,
  type ProfileId,
  type RunId,
} from '@ta-agent/workbench-domain';
import { ExecutionStatus } from '@ta-agent/workbench-extension';

import {
  LOCAL_EXECUTION_LAUNCH_FILE,
  LOCAL_EXECUTION_OBSERVATION_FILE,
  LOCAL_EXECUTION_REQUEST_FILE,
  MAXIMUM_LOCAL_COMMAND_REQUEST_BYTES,
} from '../foundation/constants.js';
import {
  LocalCommandDispatchError,
  LocalCommandWorkspaceConflictError,
} from '../foundation/errors.js';
import {
  assertStableExistingDirectory,
  ensureStableDirectory,
  isNodeError,
} from '../foundation/paths.js';
import type { ResolvedLocalCommandConfiguration } from './command-configuration.js';
import { parseLocalCommandLaunchRecord } from './command-configuration.js';
import type { LocalCommandWorkspace } from './contracts.js';

export async function prepareLocalCommandWorkspace(
  configuration: ResolvedLocalCommandConfiguration,
  input: unknown
): Promise<LocalCommandWorkspace> {
  const request = parseJsonValue(input, 'localCommand.request');
  const identity = parseRequestIdentity(request);
  const executionId = deriveExecutionId(identity.profileId, identity.runId);
  const canonicalRoot = await ensureStableDirectory(configuration.rootDirectory);
  const profileRoot = await ensureStableDirectory(join(canonicalRoot, identity.profileId));
  const executionsRoot = await ensureStableDirectory(join(profileRoot, 'executions'));
  const executionDirectory = join(executionsRoot, executionId);
  const temporaryDirectory = await mkdtemp(join(executionsRoot, '.pending-'));
  let created = false;
  try {
    await writeNewWorkspace(temporaryDirectory, request, configuration);
    try {
      await rename(temporaryDirectory, executionDirectory);
      created = true;
    } catch (cause: unknown) {
      if (!isExistingTargetError(cause)) throw cause;
    }
  } catch (cause: unknown) {
    throw new LocalCommandDispatchError(
      `Could not prepare local execution "${executionId}" workspace.`,
      { cause }
    );
  } finally {
    if (!created) await rm(temporaryDirectory, { recursive: true, force: true });
  }

  await assertStableExistingDirectory(executionDirectory);
  await assertExistingWorkspaceMatches(
    executionDirectory,
    executionId,
    request,
    configuration.launch.commandDigest
  );
  return Object.freeze({
    executionId,
    executionDirectory,
    request,
    launch: configuration.launch,
    environment: configuration.environment,
  });
}

function parseRequestIdentity(request: JsonValue): {
  readonly profileId: ProfileId;
  readonly runId: RunId;
} {
  if (!isJsonObject(request)) {
    throw new LocalCommandDispatchError('Local command request must be an object.');
  }
  return Object.freeze({
    profileId: parseProfileId(request.profileId, 'localCommand.request.profileId'),
    runId: parseRunId(request.runId, 'localCommand.request.runId'),
  });
}

function deriveExecutionId(profileId: ProfileId, runId: RunId): string {
  const digest = createHash('sha256')
    .update(profileId, 'utf8')
    .update('\0', 'utf8')
    .update(runId, 'utf8')
    .digest('hex');
  return `execution-${digest}`;
}

async function writeNewWorkspace(
  directory: string,
  request: JsonValue,
  configuration: ResolvedLocalCommandConfiguration
): Promise<void> {
  await writeExclusiveJson(
    join(directory, LOCAL_EXECUTION_REQUEST_FILE),
    request,
    MAXIMUM_LOCAL_COMMAND_REQUEST_BYTES
  );
  await writeExclusiveJson(join(directory, LOCAL_EXECUTION_LAUNCH_FILE), configuration.launch);
  await writeExclusiveJson(join(directory, LOCAL_EXECUTION_OBSERVATION_FILE), {
    status: ExecutionStatus.Running,
  });
}

async function assertExistingWorkspaceMatches(
  directory: string,
  executionId: string,
  request: JsonValue,
  commandDigest: string
): Promise<void> {
  try {
    const existingRequest = parseJsonValue(
      await readBoundedJson(
        join(directory, LOCAL_EXECUTION_REQUEST_FILE),
        MAXIMUM_LOCAL_COMMAND_REQUEST_BYTES
      ),
      'localCommand.existingRequest'
    );
    const launch = parseLocalCommandLaunchRecord(
      await readBoundedJson(join(directory, LOCAL_EXECUTION_LAUNCH_FILE), 64 * 1024)
    );
    if (
      canonicalJson(existingRequest) !== canonicalJson(request) ||
      launch.commandDigest !== commandDigest
    ) {
      throw new LocalCommandWorkspaceConflictError(executionId);
    }
  } catch (cause: unknown) {
    if (cause instanceof LocalCommandWorkspaceConflictError) throw cause;
    throw new LocalCommandDispatchError(
      `Could not validate local execution "${executionId}" workspace.`,
      { cause }
    );
  }
}

async function writeExclusiveJson(
  path: string,
  input: unknown,
  maximumBytes = 64 * 1024
): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(input)}\n`, 'utf8');
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`JSON record exceeds ${String(maximumBytes)} bytes.`);
  }
  const handle = await open(
    path,
    fileConstants.O_WRONLY |
      fileConstants.O_CREAT |
      fileConstants.O_EXCL |
      fileConstants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readBoundedJson(path: string, maximumBytes: number): Promise<unknown> {
  const handle = await open(
    path,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW | fileConstants.O_NONBLOCK
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maximumBytes) {
      throw new Error('Expected a bounded regular JSON file.');
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) throw new Error('JSON file exceeds its byte limit.');
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

function isExistingTargetError(cause: unknown): boolean {
  return isNodeError(cause) && (cause.code === 'EEXIST' || cause.code === 'ENOTEMPTY');
}

function isJsonObject(input: JsonValue): input is JsonObject {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
