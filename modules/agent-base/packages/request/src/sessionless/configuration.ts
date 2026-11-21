import { AgentRequestError } from '../errors.js';
export function closedRecord(
  input: unknown,
  keys: readonly string[],
  code: 'REQUEST_INPUT_INVALID' | 'REQUEST_CONFIGURATION_INVALID' | 'REQUEST_POLICY_INVALID'
): Readonly<Record<string, unknown>> {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    throw new AgentRequestError(code, 'Request boundary requires a plain record.');
  }
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== 'string' ||
      !keys.includes(key) ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new AgentRequestError(
        code,
        'Request boundary contains an unsupported field or accessor.'
      );
    }
  }
  return input as Readonly<Record<string, unknown>>;
}

const SESSIONLESS_WORKFLOW_OPTION_KEYS = Object.freeze([
  'mode',
  'name',
  'resources',
  'stepOverrides',
  'lifecycle',
  'condition',
  'createRunId',
  'executeStep',
]);
export function validateSessionlessWorkflowOptions(input: unknown): void {
  closedRecord(input, SESSIONLESS_WORKFLOW_OPTION_KEYS, 'REQUEST_CONFIGURATION_INVALID');
}
