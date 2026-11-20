import { WorkflowBundleDefinitionError } from './errors.js';
import type { WorkflowBundleDefinitionErrorCode } from './types.js';

type RecordValue = Readonly<Record<string, unknown>>;

export function readRecord(
  value: unknown,
  code: WorkflowBundleDefinitionErrorCode,
  allowed?: readonly string[],
  memberName?: string
): RecordValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new WorkflowBundleDefinitionError(
      code,
      'Bundle configuration must be a plain record.',
      memberName
    );
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      key.trim() === '' ||
      (allowed !== undefined && !allowed.includes(key)) ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new WorkflowBundleDefinitionError(
        code,
        'Bundle configuration contains an unsupported field or accessor.',
        memberName
      );
    }
    snapshot[key] = descriptor.value as unknown;
  }
  return Object.freeze(snapshot);
}
