import {
  WorkflowDefinitionError,
  type WorkflowContext,
  type StepExecutor,
} from '../contracts/index.js';
import { resolveStepRegistry } from '../steps/index.js';
import type { WorkflowDefinition, PreparedWorkflow } from './types/definition.js';

/** Prepare once at construction; caller-owned callbacks and Resources remain unexecuted. */
export function prepareWorkflowDefinition<N extends string, I, S, R, O>(
  definition: WorkflowDefinition<N, I, S, R, O>
): PreparedWorkflow<N, I, S, R, O> {
  if (typeof definition.name !== 'string' || definition.name.trim() === '') {
    throw new WorkflowDefinitionError(
      'WORKFLOW_NAME_INVALID',
      definition.name,
      'Workflow name is required.'
    );
  }
  const name = definition.name;
  const snapshot = Object.freeze({
    ...definition,
    lifecycle: Object.freeze({ ...definition.lifecycle }),
  });
  const { createResult, createSkippedResult } = snapshot;
  if (
    typeof createResult !== 'function' ||
    (createSkippedResult !== undefined && typeof createSkippedResult !== 'function')
  )
    throw new WorkflowDefinitionError(
      'WORKFLOW_RESULT_FACTORY_INVALID',
      name,
      'Workflow requires a callable createResult and, when supplied, a callable createSkippedResult.'
    );
  const steps = resolveStepRegistry(definition.stepDefinitions, definition.stepOverrides);
  const executor: StepExecutor<N, WorkflowContext<N, S, R>> = definition.executeStep ??
  (async ({ step, context }) => step(context));
  const entry = steps[definition.entryStep];
  if (entry === undefined)
    throw new WorkflowDefinitionError(
      'STEP_IMPLEMENTATION_MISSING',
      definition.entryStep,
      'Entry Step is not registered.'
    );
  if (entry.status === 'skipped')
    throw new WorkflowDefinitionError(
      'WORKFLOW_ENTRY_STEP_SKIPPED',
      definition.entryStep,
      'Entry Step cannot be skipped.'
    );
  return { name, definition: snapshot, steps, executor };
}
