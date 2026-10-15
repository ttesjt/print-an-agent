import { WorkflowDefinitionError } from '../errors.js';
import { SKIP_STEP } from '../types/step.js';
import { normalizeStepOverride, parseStepCardinality, readStepRecord } from './step-policy.js';
import type {
  ResolvedStep,
  ResolvedStepRegistry,
  Step,
  StepDefinitions,
  StepName,
  StepOverrides,
} from '../types/step.js';

export function resolveStepRegistry<TStepName extends StepName, C>(
  definitions: StepDefinitions<TStepName, C>,
  overrides?: StepOverrides<TStepName, C>
): ResolvedStepRegistry<TStepName, C> {
  const registered = readStepRecord(
    definitions,
    undefined,
    'STEP_DEFINITION_INVALID',
    'stepDefinitions'
  );
  const appliedOverrides = readStepRecord(
    overrides ?? {},
    undefined,
    'STEP_OVERRIDE_INVALID',
    'stepOverrides'
  );

  for (const stepName of Object.keys(appliedOverrides)) {
    if (!Object.hasOwn(registered, stepName)) {
      throw new WorkflowDefinitionError(
        'STEP_OVERRIDE_UNKNOWN',
        stepName,
        `Step override "${stepName}" does not have a registered definition.`
      );
    }
  }

  const resolved = Object.create(null) as Record<TStepName, ResolvedStep<C>>;

  for (const stepName of Object.keys(registered) as TStepName[]) {
    const definition = readStepRecord(
      registered[stepName],
      ['step', 'skippable', 'cardinality'],
      'STEP_DEFINITION_INVALID',
      stepName
    );
    const defaultCardinality = parseStepCardinality(definition.cardinality, stepName);
    if (
      typeof definition.skippable !== 'boolean' ||
      (definition.step !== undefined && typeof definition.step !== 'function')
    ) {
      throw new WorkflowDefinitionError(
        'STEP_DEFINITION_INVALID',
        stepName,
        'Step definition requires a boolean skippable policy and an optional function.'
      );
    }
    const override = normalizeStepOverride<C>(appliedOverrides[stepName], stepName);
    const cardinality = override.cardinality ?? defaultCardinality;
    const skippable = definition.skippable;
    const implementation = override.step ?? definition.step;

    if (implementation === SKIP_STEP) {
      if (!skippable) {
        throw new WorkflowDefinitionError(
          'STEP_NOT_SKIPPABLE',
          stepName,
          `Required step "${stepName}" cannot be skipped.`
        );
      }

      resolved[stepName] = Object.freeze({ status: 'skipped', cardinality, skippable });
      continue;
    }

    if (implementation === undefined) {
      throw new WorkflowDefinitionError(
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
