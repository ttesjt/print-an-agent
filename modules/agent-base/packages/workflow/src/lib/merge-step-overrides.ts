import type { AnyWorkflowContext } from '../types/context.js';
import type { StepName, StepOverrideDefinition, StepOverrides } from '../types/step.js';
import { normalizeStepOverride } from './step-policy.js';

/** Later layers replace only supplied fields; omitted fields retain the preceding layer. */
export function mergeStepOverrides<TStepName extends StepName, C extends AnyWorkflowContext>(
  ...layers: readonly (StepOverrides<TStepName, C> | undefined)[]
): StepOverrides<TStepName, C> {
  const merged: Partial<Record<TStepName, StepOverrideDefinition<C>>> = Object.create(
    null
  ) as Partial<Record<TStepName, StepOverrideDefinition<C>>>;
  for (const layer of layers) {
    if (layer === undefined) continue;
    for (const stepName of Object.keys(layer) as TStepName[]) {
      merged[stepName] = Object.freeze({
        ...merged[stepName],
        ...normalizeStepOverride(layer[stepName], stepName),
      });
    }
  }
  return Object.freeze(merged);
}
