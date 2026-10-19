import {
  Workflow,
  STEP_CARDINALITY,
  SKIP_STEP,
  mergeStepOverrides,
  type Step,
  type StepDefinitions,
} from '@ta-agent/workflow-core';
import { AgentRequestError } from '../../errors.js';
import { resolveRequestInstructions } from '../../preparation/instructions.js';
import { buildRequestTools } from '../../preparation/tools.js';
import { deliverTextDelta, deliverReasoningDelta } from '../../delivery/steps.js';
import { dispatchRequestDelta } from '../../delivery/dispatch.js';
import { createInteractionEventAccounting } from '../../interaction/budgets.js';
import { validateSessionlessRequest } from '../context.js';
import { executeSessionlessRequest } from '../execution.js';
import { sessionlessLifecycle } from '../lifecycle.js';
import { openSessionlessOutput, completeSessionlessResponse } from '../output.js';
import { closedRecord } from '../validation.js';
import { bindInteractionResources } from './resources.js';
import {
  resolveInteractionTarget,
  buildSessionlessInteractionContext,
  invokeSessionlessInteraction,
  buildInteractionResponse,
  closeSessionlessTools,
} from './steps.js';
import type {
  SessionlessInteractionContext,
  SessionlessInteractionState,
  SessionlessInteractionStepName,
  SessionlessInteractionWorkflowOptions,
} from './contracts.js';

export function createInteractionWorkflow(options: SessionlessInteractionWorkflowOptions) {
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
  const resources = bindInteractionResources(options.resources);
  if (
    typeof resources.actor.interact !== 'function' ||
    !resources.actor.capabilities.invocationModes.includes('interaction')
  )
    throw new AgentRequestError(
      'REQUEST_CONFIGURATION_INVALID',
      'Actor does not support the selected interaction profile.'
    );
  const required = (step: Step<SessionlessInteractionContext>) => ({
    step,
    cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
    skippable: false,
  });
  const repeatable = (step: Step<SessionlessInteractionContext>, skippable = false) => ({
    step,
    cardinality: STEP_CARDINALITY.REPEATABLE,
    skippable,
  });
  const sequence =
    (...names: SessionlessInteractionStepName[]): Step<SessionlessInteractionContext> =>
    async (context) => {
      for (const name of names) await context.runStep(name);
    };
  const steps: StepDefinitions<SessionlessInteractionStepName, SessionlessInteractionContext> = {
    runRequest: required(sequence('prepareRequest', 'executeRequest')),
    prepareRequest: required(
      sequence(
        'validateRequest',
        'resolveExecutionTarget',
        'resolveInstructions',
        'gatherExternalContext',
        'buildTools',
        'buildModelContext'
      )
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
    createState: (): SessionlessInteractionState => ({}),
    createResult: () => undefined,
    lifecycle: sessionlessLifecycle(options.lifecycle, closeSessionlessTools),
  });
}
