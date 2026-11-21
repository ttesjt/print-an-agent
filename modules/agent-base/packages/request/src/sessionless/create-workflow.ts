import { validateSessionlessWorkflowOptions } from './configuration.js';
import type { SessionlessGenerationWorkflowOptions } from './generation/index.js';
import { createGenerationWorkflow } from './generation/index.js';
import type { SessionlessInteractionWorkflowOptions } from './interaction/index.js';
import { createInteractionWorkflow } from './interaction/index.js';

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
  validateSessionlessWorkflowOptions(options);
  return options.mode === 'interaction'
    ? createInteractionWorkflow(options)
    : createGenerationWorkflow(options);
}
