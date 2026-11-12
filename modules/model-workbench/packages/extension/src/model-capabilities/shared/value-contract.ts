import { parseJsonValue, type JsonValue } from '@print-an-agent/workbench-domain';

import type { ExtensionValueContract } from '../../contracts/extension-value-contract.js';

export function eraseValueContract<TValue>(
  contract: ExtensionValueContract<TValue>
): ExtensionValueContract<JsonValue> {
  return Object.freeze({
    evidence: contract.evidence,
    parse: (input: unknown, path: string) => parseJsonValue(contract.parse(input, path), path),
  });
}
