import { InvalidWorkbenchValueError } from '../../foundation/errors.js';
import {
  parseBaseId,
  parseCapabilityId,
  parseExporterId,
  parseInitializerId,
  parseModificationId,
  parseOutputId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
  parseTrainerId,
} from '../../foundation/identifiers.js';
import { parseJsonValue } from '../../foundation/json.js';
import { parseTimestamp } from '../../foundation/timestamp.js';
import {
  parseClosedRecord,
  parseLiteral,
  parseStringUnion,
} from '../../foundation/record-parser.js';
import { parseModelState } from '../../model-assets/model-state.js';
import {
  ModelOperationKind,
  ModelRecordKind,
  ModelRunResultKind,
  ModelRunStatus,
} from '../constants.js';
import { parseExecutionFailure } from '../execution-failure.js';
import { parseExecutionReference } from '../execution-reference.js';
import type { ModelRun } from './contracts.js';

const operationKinds = new Set(Object.values(ModelOperationKind));
const runStatuses = new Set(Object.values(ModelRunStatus));
const resultKinds = new Set(Object.values(ModelRunResultKind));

const COMMON_KEYS = [
  'kind',
  'runId',
  'profileId',
  'capabilityId',
  'runtimeBindingId',
  'slotEvidenceDigest',
  'input',
  'createdAt',
  'operation',
  'status',
] as const;

export function parseModelRun(input: unknown, path = 'modelRun'): ModelRun {
  const parsed = parseJsonValue(input, path);
  const initial = parseClosedRecord(parsed, path, COMMON_KEYS, [
    'initializerId',
    'trainerId',
    'exporterId',
    'source',
    'dispatchedAt',
    'terminalRecordedAt',
    'execution',
    'progress',
    'result',
    'failure',
    'reason',
  ]);
  parseLiteral(initial.kind, ModelRecordKind.Run, `${path}.kind`);
  parseRunId(initial.runId, `${path}.runId`);
  parseProfileId(initial.profileId, `${path}.profileId`);
  parseCapabilityId(initial.capabilityId, `${path}.capabilityId`);
  parseRuntimeBindingId(initial.runtimeBindingId, `${path}.runtimeBindingId`);
  parseSha256Digest(initial.slotEvidenceDigest, `${path}.slotEvidenceDigest`);
  parseJsonValue(initial.input, `${path}.input`);
  parseTimestamp(initial.createdAt, `${path}.createdAt`);

  const operation = parseStringUnion(initial.operation, operationKinds, `${path}.operation`);
  const status = parseStringUnion(initial.status, runStatuses, `${path}.status`);
  assertExactRunKeys(initial, operation, status, path);
  parseOperationSelection(initial, operation, path);
  parseLifecycle(initial, operation, status, path);

  return parsed as unknown as ModelRun;
}

function assertExactRunKeys(
  record: Readonly<Record<string, unknown>>,
  operation: ModelOperationKind,
  status: ModelRunStatus,
  path: string
): void {
  const operationKeys =
    operation === ModelOperationKind.Initialization
      ? ['initializerId']
      : operation === ModelOperationKind.Training
        ? ['trainerId', 'source']
        : ['exporterId', 'source'];
  const lifecycleRequired =
    status === ModelRunStatus.Running
      ? ['dispatchedAt', 'execution']
      : status === ModelRunStatus.Succeeded
        ? ['terminalRecordedAt', 'result']
        : status === ModelRunStatus.Failed || status === ModelRunStatus.Lost
          ? ['terminalRecordedAt', 'failure']
          : status === ModelRunStatus.Cancelled
            ? ['terminalRecordedAt']
            : [];
  const lifecycleOptional =
    status === ModelRunStatus.Starting
      ? ['dispatchedAt']
      : status === ModelRunStatus.Running
        ? ['progress']
        : status === ModelRunStatus.Cancelled
          ? ['dispatchedAt', 'execution', 'progress', 'reason']
          : ['dispatchedAt', 'execution', 'progress'];
  parseClosedRecord(
    record,
    path,
    [...COMMON_KEYS, ...operationKeys, ...lifecycleRequired],
    lifecycleOptional
  );
}

function parseOperationSelection(
  record: Readonly<Record<string, unknown>>,
  operation: ModelOperationKind,
  path: string
): void {
  if (operation === ModelOperationKind.Initialization) {
    parseInitializerId(record.initializerId, `${path}.initializerId`);
    return;
  }
  parseModelState(record.source, `${path}.source`);
  if (operation === ModelOperationKind.Training) {
    parseTrainerId(record.trainerId, `${path}.trainerId`);
    return;
  }
  parseExporterId(record.exporterId, `${path}.exporterId`);
}

function parseLifecycle(
  record: Readonly<Record<string, unknown>>,
  operation: ModelOperationKind,
  status: ModelRunStatus,
  path: string
): void {
  if (Object.hasOwn(record, 'execution')) {
    parseExecutionReference(record.execution, `${path}.execution`);
  }
  if (Object.hasOwn(record, 'dispatchedAt')) {
    parseTimestamp(record.dispatchedAt, `${path}.dispatchedAt`);
  }
  if (Object.hasOwn(record, 'terminalRecordedAt')) {
    parseTimestamp(record.terminalRecordedAt, `${path}.terminalRecordedAt`);
  }
  if (Object.hasOwn(record, 'progress')) {
    parseJsonValue(record.progress, `${path}.progress`);
  }
  if (status === ModelRunStatus.Succeeded) {
    parseRunResult(record.result, operation, `${path}.result`);
  } else if (status === ModelRunStatus.Failed || status === ModelRunStatus.Lost) {
    parseExecutionFailure(record.failure, `${path}.failure`);
  } else if (status === ModelRunStatus.Cancelled && Object.hasOwn(record, 'reason')) {
    parseJsonValue(record.reason, `${path}.reason`);
  }
}

function parseRunResult(input: unknown, operation: ModelOperationKind, path: string): void {
  const initial = parseClosedRecord(
    input,
    path,
    ['kind'],
    ['baseId', 'modificationId', 'outputId', 'data']
  );
  const kind = parseStringUnion(initial.kind, resultKinds, `${path}.kind`);
  if (operation === ModelOperationKind.Initialization && kind !== ModelRunResultKind.Base) {
    throw new InvalidWorkbenchValueError(`${path}.kind`, 'must be a Base result');
  }
  if (
    operation === ModelOperationKind.Training &&
    kind !== ModelRunResultKind.Base &&
    kind !== ModelRunResultKind.Modification
  ) {
    throw new InvalidWorkbenchValueError(`${path}.kind`, 'must be a parameter result');
  }
  if (operation === ModelOperationKind.Export && kind !== ModelRunResultKind.Output) {
    throw new InvalidWorkbenchValueError(`${path}.kind`, 'must be an Output result');
  }

  const identityKey =
    kind === ModelRunResultKind.Base
      ? 'baseId'
      : kind === ModelRunResultKind.Modification
        ? 'modificationId'
        : 'outputId';
  const record = parseClosedRecord(input, path, ['kind', identityKey], ['data']);
  if (kind === ModelRunResultKind.Base) parseBaseId(record.baseId, `${path}.baseId`);
  if (kind === ModelRunResultKind.Modification) {
    parseModificationId(record.modificationId, `${path}.modificationId`);
  }
  if (kind === ModelRunResultKind.Output) parseOutputId(record.outputId, `${path}.outputId`);
  if (Object.hasOwn(record, 'data')) parseJsonValue(record.data, `${path}.data`);
}
