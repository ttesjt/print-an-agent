export const SESSIONLESS_REQUEST_STEP_NAMES = Object.freeze([
  'runRequest',
  'prepareRequest',
  'validateRequest',
  'resolveExecutionTarget',
  'resolveInstructions',
  'gatherExternalContext',
  'buildModelContext',
  'executeRequest',
  'openResponseStream',
  'invokeModel',
  'dispatchModelEvent',
  'deliverTextDelta',
  'deliverReasoningDelta',
  'buildResponse',
  'validateResponse',
  'completeResponse',
] as const);

export type SessionlessRequestStepName = (typeof SESSIONLESS_REQUEST_STEP_NAMES)[number];
