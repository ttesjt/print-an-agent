import { deriveEvidenceDigest } from '../foundation/evidence.js';
import {
  parseBaseId,
  parseModificationId,
  parseSha256Digest,
  type BaseId,
  type ModificationId,
  type Sha256Digest,
} from '../foundation/identifiers.js';
import { parseJsonValue } from '../foundation/json.js';
import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import { parseClosedRecord, parseLiteral } from '../foundation/record-parser.js';
import { ModelStateKind } from './constants.js';

export interface ModelStateInput {
  readonly baseId: string;
  readonly modificationIds?: readonly string[];
}

/** A derived receipt for one Base plus an ordered additive Modification stack. */
export interface ModelState {
  readonly kind: typeof ModelStateKind.State;
  readonly baseId: BaseId;
  readonly modificationIds: readonly ModificationId[];
  readonly evidenceDigest: Sha256Digest;
}

export function defineModelState(input: ModelStateInput): ModelState {
  const baseId = parseBaseId(input.baseId, 'modelState.baseId');
  const modificationIds = Object.freeze(
    (input.modificationIds ?? []).map((modificationId, index) =>
      parseModificationId(modificationId, `modelState.modificationIds[${String(index)}]`)
    )
  );
  const evidence = parseJsonValue({ baseId, modificationIds });
  return Object.freeze({
    kind: ModelStateKind.State,
    baseId,
    modificationIds,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

export function parseModelState(input: unknown, path = 'modelState'): ModelState {
  const record = parseClosedRecord(input, path, [
    'kind',
    'baseId',
    'modificationIds',
    'evidenceDigest',
  ]);
  parseLiteral(record.kind, ModelStateKind.State, `${path}.kind`);
  if (!Array.isArray(record.modificationIds)) {
    throw new InvalidWorkbenchValueError(`${path}.modificationIds`, 'must be an array');
  }
  const state = defineModelState({
    baseId: parseBaseId(record.baseId, `${path}.baseId`),
    modificationIds: record.modificationIds.map((value, index) =>
      parseModificationId(value, `${path}.modificationIds[${String(index)}]`)
    ),
  });
  const evidenceDigest = parseSha256Digest(record.evidenceDigest, `${path}.evidenceDigest`);
  if (evidenceDigest !== state.evidenceDigest) {
    throw new InvalidWorkbenchValueError(
      `${path}.evidenceDigest`,
      'must match the exact Base and ordered Modification stack'
    );
  }
  return state;
}

export function modelStatesEqual(left: ModelState, right: ModelState): boolean {
  if (
    left.baseId !== right.baseId ||
    left.modificationIds.length !== right.modificationIds.length
  ) {
    return false;
  }
  return left.modificationIds.every(
    (modificationId, index) => modificationId === right.modificationIds[index]
  );
}
