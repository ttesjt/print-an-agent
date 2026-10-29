export const REQUEST_WORKFLOW_NAME = 'request' as const;

export const REQUEST_STEP_NAMES = Object.freeze([
  'runRequest',
  'prepareRequest',
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
  'executeRequest',
  'runAgentInteraction',
  'openResponseStream',
  'invokeActorInteraction',
  'dispatchInteractionEvent',
  'deliverTextDelta',
  'deliverReasoningDelta',
  'captureReasoningPresentation',
  'buildTurnPresentation',
  'completeAssistantMessage',
  'buildAgentResponse',
  'completeResponse',
] as const);

export type RequestWorkflowName = typeof REQUEST_WORKFLOW_NAME;
export type RequestStepName = (typeof REQUEST_STEP_NAMES)[number];

export type RequestCompositeStepName =
  | 'runRequest'
  | 'prepareRequest'
  | 'executeRequest'
  | 'runAgentInteraction'
  | 'dispatchInteractionEvent';

export type RequestLeafStepName = Exclude<RequestStepName, RequestCompositeStepName>;
