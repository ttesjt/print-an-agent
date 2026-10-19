import {
  Workflow,
  SKIP_STEP,
  STEP_CARDINALITY,
  mergeStepOverrides,
  type Step,
  type StepDefinition,
  type StepDefinitions,
} from '@ta-agent/workflow-core';
import { AgentRequestError } from '../../errors.js';
import { executeSessionlessRequest } from '../execution.js';
import { sessionlessLifecycle } from '../lifecycle.js';
import { dispatchRequestDelta } from '../../delivery/dispatch.js';
import { closedRecord } from '../validation.js';
import { bindGenerationResources } from '../resources.js';
import {
  generationPreparationSteps,
  invokeCompletion,
  invokeGenerationStream,
  resolveGenerationTarget,
} from './steps.js';
import type {
  SessionlessGenerationContext,
  SessionlessGenerationState,
  SessionlessGenerationWorkflowOptions,
  SessionlessRequestStepName,
} from '../contracts.js';

function sequence(...names: SessionlessRequestStepName[]): Step<SessionlessGenerationContext> {
  return async (context) => {
    for (const name of names) await context.runStep(name);
  };
}

export function createGenerationWorkflow(options: SessionlessGenerationWorkflowOptions) {
  closedRecord(
    options,
    [
      'mode',
      'name',
      'resources',
      'stepOverrides',
      'lifecycle',
      'condition',
      'createRunId',
      'executeStep',
    ],
    'REQUEST_CONFIGURATION_INVALID'
  );
  if (options.mode !== 'direct' && options.mode !== 'stream')
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Generation mode must be direct or stream.'
    );
  // Capability mismatch is rejected before creating any per-run output or invoking contributors.
  const resources = bindGenerationResources(options.resources);
  const check = options.mode === 'direct' ? 'complete' : 'stream';
  if (
    typeof resources.actor[check] !== 'function' ||
    !resources.actor.capabilities.invocationModes.includes(options.mode)
  ) {
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Actor does not support the selected generation profile.'
    );
  }
  const required = (
    step: Step<SessionlessGenerationContext>
  ): StepDefinition<SessionlessGenerationContext> => ({
    step,
    cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
    skippable: false,
  });
  const repeatable = (
    step: Step<SessionlessGenerationContext>,
    skippable = false
  ): StepDefinition<SessionlessGenerationContext> => ({
    step,
    cardinality: STEP_CARDINALITY.REPEATABLE,
    skippable,
  });
  const steps: StepDefinitions<SessionlessRequestStepName, SessionlessGenerationContext> = {
    runRequest: required(sequence('prepareRequest', 'executeRequest')),
    prepareRequest: required(
      sequence(
        'validateRequest',
        'resolveExecutionTarget',
        'resolveInstructions',
        'gatherExternalContext',
        'buildModelContext'
      )
    ),
    validateRequest: required(generationPreparationSteps.validateRequest),
    resolveExecutionTarget: required(resolveGenerationTarget(options.mode)),
    resolveInstructions: required(generationPreparationSteps.resolveInstructions),
    gatherExternalContext: { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: true },
    buildModelContext: required(generationPreparationSteps.buildModelContext),
    executeRequest: required(executeSessionlessRequest),
    openResponseStream: required(generationPreparationSteps.openResponseStream),
    invokeModel: required(options.mode === 'direct' ? invokeCompletion : invokeGenerationStream),
    dispatchModelEvent: repeatable(dispatchRequestDelta),
    deliverTextDelta: repeatable(generationPreparationSteps.deliverTextDelta),
    deliverReasoningDelta: repeatable(generationPreparationSteps.deliverReasoningDelta, true),
    buildResponse: required(generationPreparationSteps.buildResponse),
    validateResponse: { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: true },
    completeResponse: required(generationPreparationSteps.completeResponse),
  };
  return new Workflow({
    ...options,
    name: options.name ?? 'sessionless-request',
    resources,
    entryStep: 'runRequest',
    stepDefinitions: steps,
    stepOverrides: mergeStepOverrides(
      { gatherExternalContext: SKIP_STEP, validateResponse: SKIP_STEP },
      options.stepOverrides
    ),
    createState: (): SessionlessGenerationState => ({}),
    createResult: () => undefined,
    lifecycle: sessionlessLifecycle(options.lifecycle),
  });
}
