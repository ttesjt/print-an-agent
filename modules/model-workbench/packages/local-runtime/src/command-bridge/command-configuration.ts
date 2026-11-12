import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { canonicalJson, parseJsonValue } from '@print-an-agent/workbench-domain';

import {
  DEFAULT_LOCAL_COMMAND_CANCELLATION_GRACE_MILLISECONDS,
  DEFAULT_LOCAL_COMMAND_CANCELLATION_POLL_MILLISECONDS,
  DEFAULT_LOCAL_SUPERVISOR_STARTUP_TIMEOUT_MILLISECONDS,
  DEFAULT_MAXIMUM_LOCAL_COMMAND_MESSAGE_BYTES,
  DEFAULT_MAXIMUM_LOCAL_COMMAND_STDERR_BYTES,
} from '../foundation/constants.js';
import { InvalidLocalCommandConfigurationError } from '../foundation/errors.js';
import { parseLocalRootDirectory } from '../foundation/paths.js';
import type {
  LocalCommandBridgeOptions,
  LocalCommandDefinition,
  LocalCommandLaunchRecord,
} from './contracts.js';
import { LocalCommandLaunchKind } from './contracts.js';

export interface ResolvedLocalCommandConfiguration {
  readonly rootDirectory: string;
  readonly launch: LocalCommandLaunchRecord;
  readonly environment: Readonly<Record<string, string>>;
  readonly supervisorStartupTimeoutMilliseconds: number;
}

export interface ResolvedLocalProcessCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory?: string;
  readonly environment: Readonly<Record<string, string>>;
}

export function resolveLocalCommandConfiguration(
  input: LocalCommandBridgeOptions
): ResolvedLocalCommandConfiguration {
  const command = resolveLocalProcessCommand(input.command);
  const maximumProtocolMessageBytes = parsePositiveInteger(
    input.maximumProtocolMessageBytes ?? DEFAULT_MAXIMUM_LOCAL_COMMAND_MESSAGE_BYTES,
    'maximumProtocolMessageBytes'
  );
  const maximumStderrBytes = parseNonNegativeInteger(
    input.maximumStderrBytes ?? DEFAULT_MAXIMUM_LOCAL_COMMAND_STDERR_BYTES,
    'maximumStderrBytes'
  );
  const cancellationGraceMilliseconds = parseNonNegativeInteger(
    input.cancellationGraceMilliseconds ?? DEFAULT_LOCAL_COMMAND_CANCELLATION_GRACE_MILLISECONDS,
    'cancellationGraceMilliseconds'
  );
  const cancellationPollMilliseconds = parsePositiveInteger(
    input.cancellationPollMilliseconds ?? DEFAULT_LOCAL_COMMAND_CANCELLATION_POLL_MILLISECONDS,
    'cancellationPollMilliseconds'
  );
  const supervisorStartupTimeoutMilliseconds = parsePositiveInteger(
    input.supervisorStartupTimeoutMilliseconds ??
      DEFAULT_LOCAL_SUPERVISOR_STARTUP_TIMEOUT_MILLISECONDS,
    'supervisorStartupTimeoutMilliseconds'
  );
  const commandEvidence = parseJsonValue({
    executable: command.executable,
    arguments: command.arguments,
    ...(command.workingDirectory === undefined
      ? {}
      : { workingDirectory: command.workingDirectory }),
    environment: command.environment,
    maximumProtocolMessageBytes,
    maximumStderrBytes,
    cancellationGraceMilliseconds,
    cancellationPollMilliseconds,
  });
  const commandDigest = `sha256:${createHash('sha256')
    .update(canonicalJson(commandEvidence), 'utf8')
    .digest('hex')}`;
  return Object.freeze({
    rootDirectory: parseLocalRootDirectory(input.rootDirectory),
    launch: Object.freeze({
      kind: LocalCommandLaunchKind.Command,
      commandDigest,
      executable: command.executable,
      arguments: command.arguments,
      ...(command.workingDirectory === undefined
        ? {}
        : { workingDirectory: command.workingDirectory }),
      maximumProtocolMessageBytes,
      maximumStderrBytes,
      cancellationGraceMilliseconds,
      cancellationPollMilliseconds,
    }),
    environment: command.environment,
    supervisorStartupTimeoutMilliseconds,
  });
}

export function resolveLocalProcessCommand(
  input: LocalCommandDefinition
): ResolvedLocalProcessCommand {
  const executable = parseAbsolutePath(input.executable, 'command.executable');
  const arguments_ = Object.freeze(
    (input.arguments ?? []).map((value, index) =>
      parseString(value, `command.arguments[${String(index)}]`)
    )
  );
  const workingDirectory =
    input.workingDirectory === undefined
      ? undefined
      : parseAbsolutePath(input.workingDirectory, 'command.workingDirectory');
  const environment = resolveEffectiveEnvironment(
    input.inheritEnvironment ?? true,
    input.environment
  );
  return Object.freeze({
    executable,
    arguments: arguments_,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    environment,
  });
}

export function parseLocalCommandLaunchRecord(input: unknown): LocalCommandLaunchRecord {
  const record = parseRecord(input, 'localCommand.launch');
  assertKeys(
    record,
    'localCommand.launch',
    [
      'kind',
      'commandDigest',
      'executable',
      'arguments',
      'maximumProtocolMessageBytes',
      'maximumStderrBytes',
      'cancellationGraceMilliseconds',
      'cancellationPollMilliseconds',
    ],
    ['workingDirectory']
  );
  if (record.kind !== LocalCommandLaunchKind.Command) {
    throw new InvalidLocalCommandConfigurationError(
      'localCommand.launch.kind must equal local-command-launch.'
    );
  }
  if (
    typeof record.commandDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.commandDigest)
  ) {
    throw new InvalidLocalCommandConfigurationError(
      'localCommand.launch.commandDigest must be a SHA-256 digest.'
    );
  }
  if (!Array.isArray(record.arguments)) {
    throw new InvalidLocalCommandConfigurationError(
      'localCommand.launch.arguments must be an array.'
    );
  }
  return Object.freeze({
    kind: LocalCommandLaunchKind.Command,
    commandDigest: record.commandDigest,
    executable: parseAbsolutePath(record.executable, 'localCommand.launch.executable'),
    arguments: Object.freeze(
      record.arguments.map((value, index) =>
        parseString(value, `localCommand.launch.arguments[${String(index)}]`)
      )
    ),
    ...(Object.hasOwn(record, 'workingDirectory')
      ? {
          workingDirectory: parseAbsolutePath(
            record.workingDirectory,
            'localCommand.launch.workingDirectory'
          ),
        }
      : {}),
    maximumProtocolMessageBytes: parsePositiveInteger(
      record.maximumProtocolMessageBytes,
      'localCommand.launch.maximumProtocolMessageBytes'
    ),
    maximumStderrBytes: parseNonNegativeInteger(
      record.maximumStderrBytes,
      'localCommand.launch.maximumStderrBytes'
    ),
    cancellationGraceMilliseconds: parseNonNegativeInteger(
      record.cancellationGraceMilliseconds,
      'localCommand.launch.cancellationGraceMilliseconds'
    ),
    cancellationPollMilliseconds: parsePositiveInteger(
      record.cancellationPollMilliseconds,
      'localCommand.launch.cancellationPollMilliseconds'
    ),
  });
}

function resolveEffectiveEnvironment(
  inheritEnvironment: boolean,
  overrides: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> {
  if (typeof inheritEnvironment !== 'boolean') {
    throw new InvalidLocalCommandConfigurationError(
      'command.inheritEnvironment must be a boolean.'
    );
  }
  if (
    overrides !== undefined &&
    (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides))
  ) {
    throw new InvalidLocalCommandConfigurationError('command.environment must be an object.');
  }
  const input = {
    ...(inheritEnvironment ? process.env : {}),
    ...(overrides ?? {}),
  };
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(input).sort()) {
    if (key.length === 0 || key.includes('=') || key.includes('\0')) {
      throw new InvalidLocalCommandConfigurationError(
        `command.environment key "${key}" is not valid.`
      );
    }
    const value = input[key];
    if (value !== undefined) {
      result[key] = parseString(value, `command.environment.${key}`);
    }
  }
  return Object.freeze(result);
}

function parseAbsolutePath(input: unknown, path: string): string {
  const value = parseString(input, path);
  if (!isAbsolute(value)) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be absolute.`);
  }
  return resolve(value);
}

function parseString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.includes('\0')) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be a string without NUL.`);
  }
  return input;
}

function parsePositiveInteger(input: unknown, path: string): number {
  const value = parseNonNegativeInteger(input, path);
  if (value === 0) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be greater than zero.`);
  }
  return value;
}

function parseNonNegativeInteger(input: unknown, path: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be a non-negative safe integer.`);
  }
  return input as number;
}

function parseRecord(input: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be an object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidLocalCommandConfigurationError(`${path} must be a plain object.`);
  }
  return input as Readonly<Record<string, unknown>>;
}

function assertKeys(
  record: Readonly<Record<string, unknown>>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new InvalidLocalCommandConfigurationError(`${path}.${key} is not allowed.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new InvalidLocalCommandConfigurationError(`${path}.${key} is required.`);
    }
  }
}
