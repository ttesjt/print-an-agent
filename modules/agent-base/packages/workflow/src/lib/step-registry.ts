import { AgentDefinitionError } from '../types/errors.js';
import type { BaseWorkflowContext } from '../types/context.js';
import { SKIP_STEP } from '../skip-step.js';
import type {
  ResolvedStep,
  ResolvedStepRegistry,
  Step,
  StepDefinitions,
  StepName,
  StepOverrides,
} from '../types/step.js';

export function resolveStepRegistry<
  TStepName extends StepName,
  C extends BaseWorkflowContext<TStepName>,
>(
  definitions: StepDefinitions<TStepName, C>,
  overrides?: StepOverrides<TStepName, C>
): ResolvedStepRegistry<TStepName, C> {
  const appliedOverrides = overrides ?? ({} as StepOverrides<TStepName, C>);

  for (const stepName of Object.keys(appliedOverrides)) {
    if (!Object.hasOwn(definitions, stepName)) {
      throw new AgentDefinitionError(
        'STEP_OVERRIDE_UNKNOWN',
        stepName,
        `Step override "${stepName}" does not have a registered definition.`
      );
    }
  }

  const resolved = Object.create(null) as Record<TStepName, ResolvedStep<C>>;

  for (const stepName of Object.keys(definitions) as TStepName[]) {
    const definition = definitions[stepName];
    const override = appliedOverrides[stepName];

    if (override === SKIP_STEP) {
      if (!definition.skippable) {
        throw new AgentDefinitionError(
          'STEP_NOT_SKIPPABLE',
          stepName,
          `Required step "${stepName}" cannot be skipped.`
        );
      }

      resolved[stepName] = Object.freeze({ status: 'skipped' });
      continue;
    }

    let step: Step<C> | undefined;
    if (override === undefined) {
      step = definition.step;
    } else {
      step = override;
    }
    if (step === undefined) {
      throw new AgentDefinitionError(
        'STEP_IMPLEMENTATION_MISSING',
        stepName,
        `Step "${stepName}" has no default implementation or explicit override.`
      );
    }

    resolved[stepName] = Object.freeze({ status: 'active', step });
  }

  return Object.freeze(resolved);
}
