import {
  WorkflowDefinitionError,
  STEP_CARDINALITY,
  type StepCardinality,
} from '../../contracts/index.js';

export function readStepRecord(
  value: unknown,
  fields: readonly string[] | undefined,
  code: 'STEP_DEFINITION_INVALID' | 'STEP_OVERRIDE_INVALID',
  stepName: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new WorkflowDefinitionError(code, stepName, 'Step configuration must be a plain record.');
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      (fields !== undefined && !fields.includes(key)) ||
      descriptor === undefined ||
      !('value' in descriptor)
    ) {
      throw new WorkflowDefinitionError(
        code,
        stepName,
        'Step configuration contains an unsupported field or accessor.'
      );
    }
    result[key] = descriptor.value as unknown;
  }
  return result;
}

export function parseStepCardinality(value: unknown, stepName: string): StepCardinality {
  if (value !== STEP_CARDINALITY.AT_MOST_ONCE && value !== STEP_CARDINALITY.REPEATABLE) {
    throw new WorkflowDefinitionError(
      'STEP_CARDINALITY_INVALID',
      stepName,
      'Step cardinality must be explicitly declared using STEP_CARDINALITY.'
    );
  }
  return value;
}
