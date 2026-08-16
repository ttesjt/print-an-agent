import { parseJsonValue, type JsonValue } from '@ta-agent/workbench-domain';

import { invalidExtension, parseDomainValue } from '../foundation/validation.js';

export interface ExtensionValueContract<TValue> {
  readonly evidence: JsonValue;
  readonly parse: (input: unknown, path: string) => TValue;
}

export interface ExtensionValueContractInput<TValue> {
  readonly evidence: unknown;
  readonly parse: (input: unknown, path: string) => TValue;
}

export function defineExtensionValueContract<TValue>(
  input: ExtensionValueContractInput<TValue>
): ExtensionValueContract<TValue> {
  if (typeof input.parse !== 'function') {
    invalidExtension('valueContract.parse', 'must be a parser function');
  }
  const evidence = parseDomainValue(
    () => parseJsonValue(input.evidence, 'valueContract.evidence'),
    'valueContract.evidence'
  );
  return Object.freeze({
    evidence,
    parse(value: unknown, path: string): TValue {
      const parsed = input.parse(value, path);
      parseJsonValue(parsed, path);
      return parsed;
    },
  });
}

export const JsonValueContract: ExtensionValueContract<JsonValue> = defineExtensionValueContract({
  evidence: { contract: 'json-value' },
  parse: (input, path) => parseJsonValue(input, path),
});
