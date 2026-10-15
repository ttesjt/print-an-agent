import type { StepName, StepOverrideDefinition, StepOverrides } from '../types/step.js';
import { normalizeStepOverride, readStepRecord } from './step-policy.js';

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
