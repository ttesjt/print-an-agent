import type { AnyAgentContext, Step, StepDefinitions } from '@ta-agent/base-workflow';
import { RequestStepNotImplementedError } from '../errors.js';
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
  'buildTools',
  'buildModelContext',
] as const satisfies readonly RequestLeafStepName[]);

const EXECUTE_REQUEST_STEPS = Object.freeze([
  'runAgentInteraction',
  'completeResponse',
] as const satisfies readonly RequestLeafStepName[]);

function createCompositeStep<WC extends RequestWorkflowContext>(
  stepNames: readonly RequestStepName[]
): Step<WC> {
  return async (context) => {
    for (const stepName of stepNames) await context.runStep(stepName);
  };
}

function createResultAwareCompositeStep<WC extends RequestWorkflowContext>(
  stepNames: readonly RequestStepName[]
): Step<WC> {
  return async (context) => {
    for (const stepName of stepNames) {
      await context.runStep(stepName);
      if (Object.hasOwn(context, 'result')) return;
    }
  };
}

function createPlaceholderStep<WC extends RequestWorkflowContext>(
  stepName: RequestLeafStepName
): Step<WC> {
  return () => Promise.reject(new RequestStepNotImplementedError(stepName));
}

export function createRequestStepDefinitions<
  C extends AnyAgentContext,
  TResult,
  WC extends RequestWorkflowContext<C, TResult>,
>(): StepDefinitions<RequestStepName, WC> {
  return Object.freeze({
    runRequest: {
      step: createResultAwareCompositeStep<WC>(['prepareRequest', 'executeRequest']),
      skippable: false,
    },
    prepareRequest: {
      step: createResultAwareCompositeStep<WC>(PREPARE_REQUEST_STEPS),
      skippable: false,
    },
    validateRequest: {
      step: createPlaceholderStep<WC>('validateRequest'),
      skippable: false,
    },
    resolveSession: {
      step: createPlaceholderStep<WC>('resolveSession'),
      skippable: false,
    },
    resolveRequestReplay: {
      step: createPlaceholderStep<WC>('resolveRequestReplay'),
      skippable: true,
    },
    beginRequest: {
      step: createPlaceholderStep<WC>('beginRequest'),
      skippable: false,
    },
    resolveExecutionTarget: {
      step: createPlaceholderStep<WC>('resolveExecutionTarget'),
      skippable: false,
    },
    resolveInstructions: {
      step: createPlaceholderStep<WC>('resolveInstructions'),
      skippable: false,
    },
    loadSessionContext: {
      step: createPlaceholderStep<WC>('loadSessionContext'),
      skippable: false,
    },
    gatherExternalContext: {
      step: createPlaceholderStep<WC>('gatherExternalContext'),
      skippable: true,
    },
    buildTools: {
      step: createPlaceholderStep<WC>('buildTools'),
      skippable: false,
    },
    buildModelContext: {
      step: createPlaceholderStep<WC>('buildModelContext'),
      skippable: false,
    },
    executeRequest: {
      step: createCompositeStep<WC>(EXECUTE_REQUEST_STEPS),
      skippable: false,
    },
    runAgentInteraction: {
      step: createPlaceholderStep<WC>('runAgentInteraction'),
      skippable: false,
    },
    completeResponse: {
      step: createPlaceholderStep<WC>('completeResponse'),
      skippable: false,
    },
  });
}
