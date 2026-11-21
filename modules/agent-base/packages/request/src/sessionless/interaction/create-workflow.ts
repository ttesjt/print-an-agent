import {
  SKIP_STEP,
  STEP_CARDINALITY,
  Workflow,
  createSequentialStep,
  mergeStepOverrides,
  type StepDefinitions,
} from '@print-an-agent/workflow-core';
import { AgentRequestError } from '../../errors.js';
import { createInteractionEventAccounting } from '../../interaction/index.js';
import {
  deliverReasoningDelta,
  deliverTextDelta,
  dispatchRequestDelta,
} from '../../output/index.js';
import { buildRequestTools, resolveRequestInstructions } from '../../preparation/index.js';
import { validateSessionlessWorkflowOptions } from '../configuration.js';
import { validateSessionlessRequest } from '../context.js';
import { executeSessionlessRequest } from '../execution.js';
import { sessionlessLifecycle } from '../lifecycle.js';
import {
  completeSessionlessResponse,
  openSessionlessOutput,
  requireCompletedSessionlessResponse,
} from '../output.js';
import { repeatableStep, requiredStep } from '../step-definitions.js';
import { bindInteractionResources } from './resources.js';
import {
  buildInteractionResponse,
  buildSessionlessInteractionContext,
  closeSessionlessTools,
  invokeSessionlessInteraction,
  resolveInteractionTarget,
} from './steps.js';
import type {
  SessionlessInteractionContext,
  SessionlessInteractionState,
  SessionlessInteractionStepName,
  SessionlessInteractionWorkflowOptions,
} from './types/profile.js';

export function createInteractionWorkflow(options: SessionlessInteractionWorkflowOptions) {
  validateSessionlessWorkflowOptions(options);
  const resources = bindInteractionResources(options.resources);
  if (
    typeof resources.actor.interact !== 'function' ||
    !resources.actor.capabilities.invocationModes.includes('interaction')
  )
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Actor does not support the selected interaction profile.'
    );
  const required = requiredStep<SessionlessInteractionContext>;
  const repeatable = repeatableStep<SessionlessInteractionContext>;
  const steps: StepDefinitions<SessionlessInteractionStepName, SessionlessInteractionContext> = {
    runRequest: required(
      createSequentialStep<SessionlessInteractionStepName, SessionlessInteractionContext>([
        'prepareRequest',
        'executeRequest',
      ])
    ),
    prepareRequest: required(
      createSequentialStep<SessionlessInteractionStepName, SessionlessInteractionContext>([
        'validateRequest',
        'resolveExecutionTarget',
        'resolveInstructions',
        'gatherExternalContext',
        'buildTools',
        'buildModelContext',
      ])
    ),
    validateRequest: required(validateSessionlessRequest),
    resolveExecutionTarget: required(resolveInteractionTarget),
    resolveInstructions: required(resolveRequestInstructions),
    gatherExternalContext: { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: true },
    buildTools: required(buildRequestTools),
    buildModelContext: required(buildSessionlessInteractionContext),
    executeRequest: required((context) =>
      executeSessionlessRequest(context, createInteractionEventAccounting(context))
    ),
    openResponseStream: required(openSessionlessOutput),
    invokeModel: required(invokeSessionlessInteraction),
    dispatchModelEvent: repeatable(dispatchRequestDelta),
    deliverTextDelta: repeatable(deliverTextDelta),
    deliverReasoningDelta: repeatable(deliverReasoningDelta, true),
    buildResponse: required(buildInteractionResponse),
    validateResponse: { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: true },
    completeResponse: required(completeSessionlessResponse),
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
    createState: ({ input }): SessionlessInteractionState => ({ input }),
    createSkippedResult: () => undefined,
    createResult: (state) => requireCompletedSessionlessResponse(state),
    lifecycle: sessionlessLifecycle(options.lifecycle, closeSessionlessTools),
  });
}
