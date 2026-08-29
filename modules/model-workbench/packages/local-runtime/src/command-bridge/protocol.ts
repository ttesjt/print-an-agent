import { parseJsonValue, type JsonValue } from '@ta-agent/workbench-domain';
import {
  ExecutionStatus,
  parseExecutionTerminal,
  type ExecutionTerminal,
} from '@ta-agent/workbench-extension';

import {
  LocalCommandProtocolMessageKind,
  type LocalCommandProtocolMessageKind as LocalCommandProtocolMessageKindValue,
} from '../foundation/constants.js';
import { LocalSupervisorError } from '../foundation/errors.js';
import type { LocalCommandProgressMessage, LocalCommandProtocolMessage } from './contracts.js';

export function parseLocalCommandProtocolMessage(
  input: unknown,
  path = 'localCommand.message'
): LocalCommandProtocolMessage {
  const record = parseRecord(input, path);
  const kind = parseMessageKind(record.kind, `${path}.kind`);
  if (kind === LocalCommandProtocolMessageKind.Progress) {
    assertKeys(record, path, ['kind'], ['progress']);
    return Object.freeze({
      kind,
      ...(Object.hasOwn(record, 'progress')
        ? { progress: parseJsonValue(record.progress, `${path}.progress`) }
        : {}),
    });
  }
  assertKeys(record, path, ['kind', 'terminal']);
  return Object.freeze({ kind, terminal: record.terminal });
}

export function progressMessageToObservation(message: LocalCommandProgressMessage): Readonly<{
  readonly status: typeof ExecutionStatus.Running;
  readonly progress?: JsonValue;
}> {
  return Object.freeze({
    status: ExecutionStatus.Running,
    ...(message.progress === undefined ? {} : { progress: message.progress }),
  });
}

export function parseLocalCommandTerminal(
  input: unknown,
  path = 'localCommand.message.terminal'
): ExecutionTerminal<JsonValue> {
  return parseExecutionTerminal(input, parseJsonValue, path);
}

function parseMessageKind(input: unknown, path: string): LocalCommandProtocolMessageKindValue {
  if (
    input === LocalCommandProtocolMessageKind.Progress ||
    input === LocalCommandProtocolMessageKind.Terminal
  ) {
    return input;
  }
  throw new LocalSupervisorError(`${path} must equal progress or terminal.`);
}

function parseRecord(input: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new LocalSupervisorError(`${path} must be an object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LocalSupervisorError(`${path} must be a plain object.`);
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
    if (!allowed.has(key)) throw new LocalSupervisorError(`${path}.${key} is not allowed.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new LocalSupervisorError(`${path}.${key} is required.`);
    }
  }
}
