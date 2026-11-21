import type { SessionlessGenerationWorkflowOptions } from './contracts.js';
import { createGenerationWorkflow } from './generation/index.js';
import type { SessionlessInteractionWorkflowOptions } from './interaction/index.js';
import { createInteractionWorkflow } from './interaction/index.js';
import { closedRecord } from './validation.js';

export type SessionlessRequestWorkflowOptions =
  | SessionlessGenerationWorkflowOptions
  | SessionlessInteractionWorkflowOptions;

export function createSessionlessRequestWorkflow(
  options: SessionlessGenerationWorkflowOptions
): ReturnType<typeof createGenerationWorkflow>;
export function createSessionlessRequestWorkflow(
  options: SessionlessInteractionWorkflowOptions
): ReturnType<typeof createInteractionWorkflow>;
export function createSessionlessRequestWorkflow(
  options: SessionlessRequestWorkflowOptions
): ReturnType<typeof createGenerationWorkflow> | ReturnType<typeof createInteractionWorkflow>;
export function createSessionlessRequestWorkflow(options: SessionlessRequestWorkflowOptions) {
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
  return options.mode === 'interaction'
    ? createInteractionWorkflow(options)
    : createGenerationWorkflow(options);
}
