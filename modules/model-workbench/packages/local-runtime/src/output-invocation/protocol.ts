import { parseJsonValue, type JsonValue } from '@ta-agent/workbench-domain';

import { LocalOutputInvocationMessageKind } from '../foundation/constants.js';
import { LocalOutputInvocationError } from '../foundation/errors.js';

export type LocalOutputInvocationMessage =
  | Readonly<{
      kind: typeof LocalOutputInvocationMessageKind.Completed;
      result: JsonValue;
    }>
  | Readonly<{ kind: typeof LocalOutputInvocationMessageKind.StreamStart }>
  | Readonly<{
      kind: typeof LocalOutputInvocationMessageKind.Chunk;
      result: JsonValue;
    }>;

export function parseLocalOutputInvocationMessage(line: string): LocalOutputInvocationMessage {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (cause: unknown) {
    throw new LocalOutputInvocationError('The local Output Invoker wrote invalid JSON.', { cause });
  }
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new LocalOutputInvocationError('The local Output Invoker wrote an invalid message.');
  }
  if (value.kind === LocalOutputInvocationMessageKind.StreamStart) {
    assertKeys(value, ['kind']);
    return Object.freeze({ kind: LocalOutputInvocationMessageKind.StreamStart });
  }
  if (
    value.kind === LocalOutputInvocationMessageKind.Completed ||
    value.kind === LocalOutputInvocationMessageKind.Chunk
  ) {
    assertKeys(value, ['kind', 'result']);
    return Object.freeze({ kind: value.kind, result: parseJsonValue(value.result) });
  }
  throw new LocalOutputInvocationError('The local Output Invoker wrote an unknown message kind.');
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function assertKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new LocalOutputInvocationError('The local Output Invoker wrote an invalid message.');
  }
}
