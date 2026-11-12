import {
  canonicalJson,
  parseJsonValue,
  parseModelBase,
  parseModelModification,
  parseModelOutput,
  parseModelRun,
  type ModelBase,
  type ModelModification,
  type ModelOutput,
  type ModelRun,
} from '@print-an-agent/workbench-domain';

import { PersistenceDataCorruptionError } from '../../errors.js';

export function serializePersistenceRecord(record: unknown): string {
  return canonicalJson(parseJsonValue(record, 'persistenceRecord'));
}

export function deserializeRun(payload: string, identity: string): ModelRun {
  return deserialize(payload, 'run', identity, parseModelRun);
}

export function deserializeBase(payload: string, identity: string): ModelBase {
  return deserialize(payload, 'base', identity, parseModelBase);
}

export function deserializeModification(payload: string, identity: string): ModelModification {
  return deserialize(payload, 'modification', identity, parseModelModification);
}

export function deserializeOutput(payload: string, identity: string): ModelOutput {
  return deserialize(payload, 'output', identity, parseModelOutput);
}

function deserialize<TRecord>(
  payload: string,
  recordKind: string,
  identity: string,
  parse: (input: unknown, path?: string) => TRecord
): TRecord {
  try {
    const decoded = JSON.parse(payload) as unknown;
    return parse(decoded, `stored.${recordKind}`);
  } catch (cause) {
    throw new PersistenceDataCorruptionError(recordKind, identity, { cause });
  }
}
