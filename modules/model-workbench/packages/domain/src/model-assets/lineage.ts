import type {
  CapabilityId,
  ExporterId,
  InitializerId,
  RunId,
  RuntimeBindingId,
  Sha256Digest,
  TrainerId,
} from '../foundation/identifiers.js';
import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import {
  parseCapabilityId,
  parseExporterId,
  parseInitializerId,
  parseRunId,
  parseRuntimeBindingId,
  parseSha256Digest,
  parseTrainerId,
} from '../foundation/identifiers.js';
import { parseClosedRecord, parseStringUnion } from '../foundation/record-parser.js';
import { ModelOperationKind } from '../operations/constants.js';
import { parseModelState, type ModelState } from './model-state.js';

interface ModelOperationLineageBase {
  readonly runId: RunId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
  readonly slotEvidenceDigest: Sha256Digest;
}

export interface InitializationLineage extends ModelOperationLineageBase {
  readonly kind: typeof ModelOperationKind.Initialization;
  readonly initializerId: InitializerId;
}

export interface TrainingLineage extends ModelOperationLineageBase {
  readonly kind: typeof ModelOperationKind.Training;
  readonly trainerId: TrainerId;
  readonly source: ModelState;
}

export interface ExportLineage extends ModelOperationLineageBase {
  readonly kind: typeof ModelOperationKind.Export;
  readonly exporterId: ExporterId;
  readonly source: ModelState;
}

export type ModelBaseLineage = InitializationLineage | TrainingLineage;

const lineageKinds = new Set([
  ModelOperationKind.Initialization,
  ModelOperationKind.Training,
  ModelOperationKind.Export,
]);

export function parseInitializationLineage(
  input: unknown,
  path = 'initializationLineage'
): InitializationLineage {
  const record = parseClosedRecord(input, path, [
    'kind',
    'runId',
    'initializerId',
    'capabilityId',
    'runtimeBindingId',
    'slotEvidenceDigest',
  ]);
  return Object.freeze({
    kind: parseLineageKind(record.kind, ModelOperationKind.Initialization, `${path}.kind`),
    runId: parseRunId(record.runId, `${path}.runId`),
    initializerId: parseInitializerId(record.initializerId, `${path}.initializerId`),
    capabilityId: parseCapabilityId(record.capabilityId, `${path}.capabilityId`),
    runtimeBindingId: parseRuntimeBindingId(record.runtimeBindingId, `${path}.runtimeBindingId`),
    slotEvidenceDigest: parseSha256Digest(record.slotEvidenceDigest, `${path}.slotEvidenceDigest`),
  });
}

export function parseTrainingLineage(input: unknown, path = 'trainingLineage'): TrainingLineage {
  const record = parseClosedRecord(input, path, [
    'kind',
    'runId',
    'trainerId',
    'capabilityId',
    'runtimeBindingId',
    'slotEvidenceDigest',
    'source',
  ]);
  return Object.freeze({
    kind: parseLineageKind(record.kind, ModelOperationKind.Training, `${path}.kind`),
    runId: parseRunId(record.runId, `${path}.runId`),
    trainerId: parseTrainerId(record.trainerId, `${path}.trainerId`),
    capabilityId: parseCapabilityId(record.capabilityId, `${path}.capabilityId`),
    runtimeBindingId: parseRuntimeBindingId(record.runtimeBindingId, `${path}.runtimeBindingId`),
    slotEvidenceDigest: parseSha256Digest(record.slotEvidenceDigest, `${path}.slotEvidenceDigest`),
    source: parseModelState(record.source, `${path}.source`),
  });
}

export function parseExportLineage(input: unknown, path = 'exportLineage'): ExportLineage {
  const record = parseClosedRecord(input, path, [
    'kind',
    'runId',
    'exporterId',
    'capabilityId',
    'runtimeBindingId',
    'slotEvidenceDigest',
    'source',
  ]);
  return Object.freeze({
    kind: parseLineageKind(record.kind, ModelOperationKind.Export, `${path}.kind`),
    runId: parseRunId(record.runId, `${path}.runId`),
    exporterId: parseExporterId(record.exporterId, `${path}.exporterId`),
    capabilityId: parseCapabilityId(record.capabilityId, `${path}.capabilityId`),
    runtimeBindingId: parseRuntimeBindingId(record.runtimeBindingId, `${path}.runtimeBindingId`),
    slotEvidenceDigest: parseSha256Digest(record.slotEvidenceDigest, `${path}.slotEvidenceDigest`),
    source: parseModelState(record.source, `${path}.source`),
  });
}

function parseLineageKind<TKind extends ModelOperationKind>(
  input: unknown,
  expected: TKind,
  path: string
): TKind {
  const kind = parseStringUnion(input, lineageKinds, path);
  if (kind !== expected) {
    throw new InvalidWorkbenchValueError(path, `must equal "${expected}"`);
  }
  return expected;
}
