import { parseJsonValue, type JsonObject, type JsonValue } from '@print-an-agent/workbench-domain';

import { LocalArtifactReceiptKind } from '../foundation/constants.js';
import { InvalidLocalRuntimeReceiptError } from '../foundation/errors.js';
import { parsePortableRelativePath } from '../foundation/paths.js';
import type { LocalDirectoryArtifactReceipt } from './contracts.js';

export function defineLocalDirectoryArtifactReceipt(input: {
  readonly relativePath: string;
}): LocalDirectoryArtifactReceipt {
  return Object.freeze({
    kind: LocalArtifactReceiptKind.Directory,
    relativePath: parsePortableRelativePath(
      input.relativePath,
      'localArtifactReceipt.relativePath'
    ),
  });
}

export function parseLocalDirectoryArtifactReceipt(
  input: JsonValue
): LocalDirectoryArtifactReceipt {
  const value = parseJsonValue(input, 'localArtifactReceipt');
  if (!isJsonObject(value)) {
    throw new InvalidLocalRuntimeReceiptError('Local Artifact receipt must be an object.');
  }
  if (
    Object.keys(value).length !== 2 ||
    value.kind !== LocalArtifactReceiptKind.Directory ||
    !Object.hasOwn(value, 'relativePath')
  ) {
    throw new InvalidLocalRuntimeReceiptError(
      'Local Artifact receipt must contain only kind and relativePath.'
    );
  }
  return defineLocalDirectoryArtifactReceipt({
    relativePath: parsePortableRelativePath(
      value.relativePath,
      'localArtifactReceipt.relativePath'
    ),
  });
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
