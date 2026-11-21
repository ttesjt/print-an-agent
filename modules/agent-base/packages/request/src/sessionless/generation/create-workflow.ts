import {
  SKIP_STEP,
  STEP_CARDINALITY,
  Workflow,
  createSequentialStep,
  mergeStepOverrides,
  type StepDefinitions,
} from '@print-an-agent/workflow-core';
import { AgentRequestError } from '../../errors.js';
import { dispatchRequestDelta } from '../../output/index.js';
import { validateSessionlessWorkflowOptions } from '../configuration.js';
import { executeSessionlessRequest } from '../execution.js';
import { sessionlessLifecycle } from '../lifecycle.js';
import type { SessionlessRequestStepName } from '../names.js';
import { requireCompletedSessionlessResponse } from '../output.js';
import { bindSessionlessResources } from '../resources.js';
import { repeatableStep, requiredStep } from '../step-definitions.js';
import {
  generationPreparationSteps,
  invokeCompletion,
  invokeGenerationStream,
  resolveGenerationTarget,
} from './steps.js';
import type {
  BoundSessionlessGenerationResources,
  SessionlessGenerationContext,
  SessionlessGenerationState,
  SessionlessGenerationWorkflowOptions,
} from './types.js';

export function createGenerationWorkflow(options: SessionlessGenerationWorkflowOptions) {
  validateSessionlessWorkflowOptions(options);
  if (options.mode !== 'direct' && options.mode !== 'stream')
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Generation mode must be direct or stream.'
    );
  // Capability mismatch is rejected before creating any per-run output or invoking contributors.
  const resources: BoundSessionlessGenerationResources = bindSessionlessResources(
    options.resources
  );
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
  const required = requiredStep<SessionlessGenerationContext>;
  const repeatable = repeatableStep<SessionlessGenerationContext>;
  const steps: StepDefinitions<SessionlessRequestStepName, SessionlessGenerationContext> = {
    runRequest: required(
      createSequentialStep<SessionlessRequestStepName, SessionlessGenerationContext>([
        'prepareRequest',
        'executeRequest',
      ])
    ),
    prepareRequest: required(
      createSequentialStep<SessionlessRequestStepName, SessionlessGenerationContext>([
        'validateRequest',
        'resolveExecutionTarget',
        'resolveInstructions',
        'gatherExternalContext',
        'buildModelContext',
      ])
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
    createState: ({ input }): SessionlessGenerationState => ({ input }),
    createSkippedResult: () => undefined,
    createResult: (state) => requireCompletedSessionlessResponse(state),
    lifecycle: sessionlessLifecycle(options.lifecycle),
  });
}
