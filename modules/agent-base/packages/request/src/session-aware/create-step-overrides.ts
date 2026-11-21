import { SKIP_STEP, type StepOverrides } from '@print-an-agent/workflow-core';
import { buildInteractionRequest, resolveRequestInstructions } from '../preparation/index.js';
import { createInteractionStepOverrides } from './interaction/steps.js';
import { completeResponse } from './output/complete-response.js';
import { loadContextMemory, loadSessionContext } from './preparation/context.js';
import { buildTools, resolveExecutionTarget } from './preparation/execution-target.js';
import { validateRequest } from './preparation/input.js';
import { resolveRequestReplay } from './preparation/replay.js';
import { beginRequest, resolveSession } from './preparation/session.js';
import type { DefaultRequestWorkflowContext } from './types/workflow.js';
import type { RequestStepName } from './workflow/index.js';
export function createDefaultRequestStepOverrides(): StepOverrides<
  RequestStepName,
  DefaultRequestWorkflowContext
> {
  return Object.freeze({
    validateRequest,
    resolveSession,
    resolveRequestReplay,
    beginRequest,
    resolveExecutionTarget,
    resolveInstructions: resolveRequestInstructions,
    loadSessionContext,
    gatherExternalContext: SKIP_STEP,
    loadContextMemory,
    buildTools,
    buildModelContext: buildInteractionRequest,
    ...createInteractionStepOverrides(),
    completeResponse,
  });
}
