import {
  WorkflowDefinitionError,
  SKIP_STEP,
  type Step,
  type StepName,
  type StepOverrideDefinition,
  type StepOverrides,
} from '../../contracts/index.js';
import { readStepRecord, parseStepCardinality } from './validation.js';

export function normalizeStepOverride<C>(
  value: unknown,
  stepName: string
): StepOverrideDefinition<C> {
  if (value === undefined) return Object.freeze({});
  if (typeof value === 'function') return Object.freeze({ step: value as Step<C> });
  if (value === SKIP_STEP) return Object.freeze({ step: SKIP_STEP });
  const record = readStepRecord(value, ['step', 'cardinality'], 'STEP_OVERRIDE_INVALID', stepName);
  if (record.step !== undefined && typeof record.step !== 'function' && record.step !== SKIP_STEP) {
    throw new WorkflowDefinitionError(
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

/** Later layers replace only supplied fields; omitted fields retain the preceding layer. */
export function mergeStepOverrides<TStepName extends StepName, C>(
  ...layers: readonly (StepOverrides<TStepName, C> | undefined)[]
): StepOverrides<TStepName, C> {
  const merged: Partial<Record<TStepName, StepOverrideDefinition<C>>> = Object.create(
    null
  ) as Partial<Record<TStepName, StepOverrideDefinition<C>>>;
  for (const layer of layers) {
    if (layer === undefined) continue;
    const snapshot = readStepRecord(layer, undefined, 'STEP_OVERRIDE_INVALID', 'stepOverrides');
    for (const stepName of Object.keys(snapshot) as TStepName[]) {
      merged[stepName] = Object.freeze({
        ...merged[stepName],
        ...normalizeStepOverride<C>(snapshot[stepName], stepName),
      });
    }
  }
  return Object.freeze(merged);
}
