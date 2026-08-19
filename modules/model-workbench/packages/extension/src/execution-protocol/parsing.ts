import {
  InvalidWorkbenchValueError,
  parseExecutionFailure,
  parseJsonValue,
  type JsonValue,
} from '@ta-agent/workbench-domain';

import { parseClosedRecord } from '../foundation/parsing.js';
import { CapabilityDispatchKind, ExecutionStatus } from './constants.js';
import type { CapabilityDispatch, ExecutionObservation, ExecutionTerminal } from './contracts.js';

export function parseCapabilityDispatch<TResult>(
  input: unknown,
  parseResult: (input: unknown, path: string) => TResult,
  path = 'dispatch'
): CapabilityDispatch<TResult> {
  const record = parseClosedRecord(input, path, ['kind'], ['terminal', 'executionReceipt']);
  if (record.kind === CapabilityDispatchKind.Completed) {
    const completed = parseClosedRecord(input, path, ['kind', 'terminal']);
    return Object.freeze({
      kind: CapabilityDispatchKind.Completed,
      terminal: parseExecutionTerminal(completed.terminal, parseResult, `${path}.terminal`),
    });
  }
  if (record.kind === CapabilityDispatchKind.Accepted) {
    const accepted = parseClosedRecord(input, path, ['kind', 'executionReceipt']);
    return Object.freeze({
      kind: CapabilityDispatchKind.Accepted,
      executionReceipt: parseJsonValue(accepted.executionReceipt, `${path}.executionReceipt`),
    });
  }
  throw new InvalidWorkbenchValueError(
    `${path}.kind`,
    `must equal ${CapabilityDispatchKind.Completed} or ${CapabilityDispatchKind.Accepted}`
  );
}

export function parseExecutionObservation(
  input: unknown,
  path = 'observation'
): ExecutionObservation<JsonValue> {
  const record = parseClosedRecord(
    input,
    path,
    ['status'],
    ['progress', 'result', 'failure', 'reason']
  );
  if (record.status === ExecutionStatus.Running) {
    const running = parseClosedRecord(input, path, ['status'], ['progress']);
    return Object.freeze({
      status: ExecutionStatus.Running,
      ...(Object.hasOwn(running, 'progress')
        ? { progress: parseJsonValue(running.progress, `${path}.progress`) }
        : {}),
    });
  }
  return parseExecutionTerminal(record, parseJsonValue, path);
}

export function parseExecutionTerminal<TResult>(
  input: unknown,
  parseResult: (input: unknown, path: string) => TResult,
  path = 'terminal'
): ExecutionTerminal<TResult> {
  const record = parseClosedRecord(input, path, ['status'], ['result', 'failure', 'reason']);
  if (record.status === ExecutionStatus.Succeeded) {
    const succeeded = parseClosedRecord(input, path, ['status', 'result']);
    return Object.freeze({
      status: ExecutionStatus.Succeeded,
      result: parseResult(succeeded.result, `${path}.result`),
    });
  }
  if (record.status === ExecutionStatus.Failed) {
    const failed = parseClosedRecord(input, path, ['status', 'failure']);
    return Object.freeze({
      status: ExecutionStatus.Failed,
      failure: parseExecutionFailure(failed.failure, `${path}.failure`),
    });
  }
  if (record.status === ExecutionStatus.Cancelled) {
    const cancelled = parseClosedRecord(input, path, ['status'], ['reason']);
    return Object.freeze({
      status: ExecutionStatus.Cancelled,
      ...(Object.hasOwn(cancelled, 'reason')
        ? { reason: parseJsonValue(cancelled.reason, `${path}.reason`) }
        : {}),
    });
  }
  if (record.status === ExecutionStatus.Lost) {
    const lost = parseClosedRecord(input, path, ['status', 'failure']);
    return Object.freeze({
      status: ExecutionStatus.Lost,
      failure: parseExecutionFailure(lost.failure, `${path}.failure`),
    });
  }
  throw new InvalidWorkbenchValueError(
    `${path}.status`,
    'must equal succeeded, failed, cancelled, or lost'
  );
}
