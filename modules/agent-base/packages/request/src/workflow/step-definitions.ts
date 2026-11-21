import { STEP_CARDINALITY, type Step, type StepDefinitions } from '@print-an-agent/workflow-core';
import { AgentRequestError } from '../errors.js';
import { RequestStepNotImplementedError } from './errors.js';
import type { RequestLeafStepName, RequestStepName } from './names.js';
import type { RequestWorkflowContext } from './types.js';

const PREPARE_REQUEST_STEPS = Object.freeze([
  'validateRequest',
  'resolveSession',
  'resolveRequestReplay',
  'beginRequest',
  'resolveExecutionTarget',
  'resolveInstructions',
  'loadSessionContext',
  'gatherExternalContext',
  'loadContextMemory',
  'buildTools',
  'buildModelContext',
] as const satisfies readonly RequestStepName[]);

const EXECUTE_REQUEST_STEPS = Object.freeze([
  'runAgentInteraction',
  'completeResponse',
] as const satisfies readonly RequestStepName[]);

async function dispatchInteractionEvent(context: RequestWorkflowContext): Promise<void> {
  const event = context.state.interaction?.currentEvent;
  if (event === undefined)
    throw new AgentRequestError(
      'REQUEST_INTERACTION_EVENT_INVALID',
      'Event dispatch requires a current interaction event.'
    );
  if (event.type === 'text-delta') await context.runStep('deliverTextDelta');
  else if (event.type === 'reasoning-delta') {
    await context.runStep('captureReasoningPresentation');
    await context.runStep('deliverReasoningDelta');
  } else if (event.type === 'assistant-complete') {
    await context.runStep('buildTurnPresentation');
    await context.runStep('completeAssistantMessage');
  }
}

function createCompositeStep<WC extends RequestWorkflowContext>(
  stepNames: readonly RequestStepName[]
): Step<WC> {
  return async (context) => {
    for (const stepName of stepNames) await context.runStep(stepName);
  };
}

function createResponseAwareCompositeStep<WC extends RequestWorkflowContext>(
  stepNames: readonly RequestStepName[]
): Step<WC> {
  return async (context) => {
    for (const stepName of stepNames) {
      await context.runStep(stepName);
      if (context.state.completedResponse !== undefined) return;
    }
  };
}

function createPlaceholderStep<WC extends RequestWorkflowContext>(
  stepName: RequestLeafStepName
): Step<WC> {
  return () => Promise.reject(new RequestStepNotImplementedError(stepName));
}

export function createRequestStepDefinitions<WC extends RequestWorkflowContext>(): StepDefinitions<
  RequestStepName,
  WC
> {
  return Object.freeze({
    runRequest: {
      step: createResponseAwareCompositeStep<WC>(['prepareRequest', 'executeRequest']),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    prepareRequest: {
      step: createResponseAwareCompositeStep<WC>(PREPARE_REQUEST_STEPS),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    validateRequest: {
      step: createPlaceholderStep<WC>('validateRequest'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveSession: {
      step: createPlaceholderStep<WC>('resolveSession'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveRequestReplay: {
      step: createPlaceholderStep<WC>('resolveRequestReplay'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: true,
    },
    beginRequest: {
      step: createPlaceholderStep<WC>('beginRequest'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveExecutionTarget: {
      step: createPlaceholderStep<WC>('resolveExecutionTarget'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveInstructions: {
      step: createPlaceholderStep<WC>('resolveInstructions'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    loadSessionContext: {
      step: createPlaceholderStep<WC>('loadSessionContext'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    gatherExternalContext: {
      step: createPlaceholderStep<WC>('gatherExternalContext'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: true,
    },
    loadContextMemory: {
      step: createPlaceholderStep<WC>('loadContextMemory'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: true,
    },
    buildTools: {
      step: createPlaceholderStep<WC>('buildTools'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    buildModelContext: {
      step: createPlaceholderStep<WC>('buildModelContext'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    executeRequest: {
      step: createCompositeStep<WC>(EXECUTE_REQUEST_STEPS),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    runAgentInteraction: {
      step: createCompositeStep<WC>([
        'openResponseStream',
        'invokeActorInteraction',
        'buildAgentResponse',
      ]),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    openResponseStream: {
      step: createPlaceholderStep<WC>('openResponseStream'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    invokeActorInteraction: {
      step: createPlaceholderStep<WC>('invokeActorInteraction'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    dispatchInteractionEvent: {
      step: dispatchInteractionEvent,
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    deliverTextDelta: {
      step: createPlaceholderStep<WC>('deliverTextDelta'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    deliverReasoningDelta: {
      step: createPlaceholderStep<WC>('deliverReasoningDelta'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: true,
    },
    completeAssistantMessage: {
      step: createPlaceholderStep<WC>('completeAssistantMessage'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    captureReasoningPresentation: {
      step: createPlaceholderStep<WC>('captureReasoningPresentation'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: true,
    },
    buildTurnPresentation: {
      step: createPlaceholderStep<WC>('buildTurnPresentation'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: true,
    },
    buildAgentResponse: {
      step: createPlaceholderStep<WC>('buildAgentResponse'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    completeResponse: {
      step: createPlaceholderStep<WC>('completeResponse'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
  });
}
