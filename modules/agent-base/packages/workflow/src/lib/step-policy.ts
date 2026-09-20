import { SKIP_STEP } from '../skip-step.js';
import { STEP_CARDINALITY, type StepCardinality } from '../step-cardinality.js';
import { AgentDefinitionError } from '../types/errors.js';
import type { AnyWorkflowContext } from '../types/context.js';
import type { Step, StepOverride, StepOverrideDefinition } from '../types/step.js';

export function readStepRecord(
  value: unknown,
  fields: readonly string[],
  code: 'STEP_DEFINITION_INVALID' | 'STEP_OVERRIDE_INVALID',
  stepName: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new AgentDefinitionError(code, stepName, 'Step configuration must be a plain record.');
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !fields.includes(key) ||
      descriptor === undefined ||
      !('value' in descriptor)
    ) {
      throw new AgentDefinitionError(
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
    throw new AgentDefinitionError(
      'STEP_CARDINALITY_INVALID',
      stepName,
      'Step cardinality must be explicitly declared using STEP_CARDINALITY.'
    );
  }
  return value;
}

export function normalizeStepOverride<C extends AnyWorkflowContext>(
  value: StepOverride<C>,
  stepName: string
): StepOverrideDefinition<C> {
  if (value === undefined) return Object.freeze({});
  if (typeof value === 'function' || value === SKIP_STEP) return Object.freeze({ step: value });
  const record = readStepRecord(value, ['step', 'cardinality'], 'STEP_OVERRIDE_INVALID', stepName);
  if (record.step !== undefined && typeof record.step !== 'function' && record.step !== SKIP_STEP) {
    throw new AgentDefinitionError(
      'STEP_OVERRIDE_INVALID',
      stepName,
      'Step override must supply a function or SKIP_STEP.'
    );
  }
  // Executable functions remain caller-owned; the boundary validates their shape, not their body.
  const step = record.step as Step<C> | typeof SKIP_STEP | undefined;
  return Object.freeze({
    ...(step === undefined ? {} : { step }),
    ...(record.cardinality === undefined
      ? {}
      : { cardinality: parseStepCardinality(record.cardinality, stepName) }),
  });
}
