import { parseJsonValue, type JsonObject, type JsonValue } from '@print-an-agent/workbench-domain';

import { LocalExecutionReceiptKind } from '../foundation/constants.js';
import { InvalidLocalRuntimeReceiptError } from '../foundation/errors.js';
import type { LocalFilesystemExecutionReceipt } from './contracts.js';

const LOCAL_EXECUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function defineLocalExecutionReceipt(input: {
  readonly executionId: string;
}): LocalFilesystemExecutionReceipt {
  return Object.freeze({
    kind: LocalExecutionReceiptKind.FilesystemRecord,
    executionId: parseLocalExecutionId(input.executionId),
  });
}

export function parseLocalExecutionReceipt(input: JsonValue): LocalFilesystemExecutionReceipt {
  const value = parseJsonValue(input, 'localExecutionReceipt');
  if (!isJsonObject(value)) {
    throw new InvalidLocalRuntimeReceiptError('Local execution receipt must be an object.');
  }
  if (
    Object.keys(value).length !== 2 ||
    value.kind !== LocalExecutionReceiptKind.FilesystemRecord ||
    !Object.hasOwn(value, 'executionId')
  ) {
    throw new InvalidLocalRuntimeReceiptError(
      'Local execution receipt must contain only kind and executionId.'
    );
  }
  return defineLocalExecutionReceipt({ executionId: parseLocalExecutionId(value.executionId) });
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLocalExecutionId(input: unknown): string {
  if (typeof input !== 'string' || !LOCAL_EXECUTION_ID_PATTERN.test(input)) {
    throw new InvalidLocalRuntimeReceiptError(
      'localExecutionReceipt.executionId must be a portable identifier.'
    );
  }
  return input;
}
