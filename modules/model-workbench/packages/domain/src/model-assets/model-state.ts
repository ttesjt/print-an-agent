import { deriveEvidenceDigest } from '../foundation/evidence.js';
import {
  parseBaseId,
  parseModificationId,
  type BaseId,
  type ModificationId,
  type Sha256Digest,
} from '../foundation/identifiers.js';
import { parseJsonValue } from '../foundation/json.js';
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
