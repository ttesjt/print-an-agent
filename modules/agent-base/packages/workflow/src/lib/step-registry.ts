import { AgentDefinitionError } from '../types/errors.js';
import type { BaseWorkflowContext } from '../types/context.js';
import { SKIP_STEP } from '../skip-step.js';
import { normalizeStepOverride, parseStepCardinality, readStepRecord } from './step-policy.js';
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
    const definition = readStepRecord(
      definitions[stepName],
      ['step', 'skippable', 'cardinality'],
      'STEP_DEFINITION_INVALID',
      stepName
    );
    const defaultCardinality = parseStepCardinality(definition.cardinality, stepName);
    if (
      typeof definition.skippable !== 'boolean' ||
      (definition.step !== undefined && typeof definition.step !== 'function')
    ) {
      throw new AgentDefinitionError(
        'STEP_DEFINITION_INVALID',
        stepName,
        'Step definition requires a boolean skippable policy and an optional function.'
      );
    }
    const override = normalizeStepOverride(appliedOverrides[stepName], stepName);
    const cardinality = override.cardinality ?? defaultCardinality;
    const skippable = definition.skippable;
    const implementation = override.step ?? definition.step;

    if (implementation === SKIP_STEP) {
      if (!skippable) {
        throw new AgentDefinitionError(
          'STEP_NOT_SKIPPABLE',
          stepName,
          `Required step "${stepName}" cannot be skipped.`
        );
      }

      resolved[stepName] = Object.freeze({ status: 'skipped', cardinality, skippable });
      continue;
    }

    if (implementation === undefined) {
      throw new AgentDefinitionError(
        'STEP_IMPLEMENTATION_MISSING',
        stepName,
        `Step "${stepName}" has no default implementation or explicit override.`
      );
    }

    const step = implementation as Step<C>;
    resolved[stepName] = Object.freeze({ status: 'active', step, cardinality, skippable });
  }

  return Object.freeze(resolved);
}
