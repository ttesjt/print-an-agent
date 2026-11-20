import { traceErrorCode } from '@print-an-agent/base-observability';

import { AgentDefinitionError, AgentRunError } from '../errors.js';

import type { AnyAgentRunContext } from '../types/context.js';

import { requireSynchronousInput } from './input-projection.js';

import { createWorkflowTraceObserver } from './tracing.js';

import type { AgentWorkflow, AgentWorkflowBinding } from './types/binding.js';

/** Bind a Core Workflow with explicit input projection, Run correlation and result application. */
export function bindAgentWorkflow<C extends AnyAgentRunContext, TInput, TResult>(
  binding: AgentWorkflowBinding<C, TInput, TResult>
): AgentWorkflow<C, TResult> {
  const { workflow, projectInput, applyResult } = binding;
  if (typeof projectInput !== 'function') {
    throw new AgentDefinitionError(
      'WORKFLOW_INPUT_PROJECTION_INVALID',
      workflow.name,
      'Workflow binding requires a projectInput function.'
    );
  }
  return Object.freeze({
    name: workflow.name,
    async run(context: C) {
      const input = requireSynchronousInput(projectInput(context), workflow.name);
      const result = await workflow.run({
        input,
        signal: context.signal,
        parentRunId: context.runId,
        classifyFailure: traceErrorCode,
        ...(context.traceEmitter === undefined
          ? {}
          : { onEvent: createWorkflowTraceObserver(context.traceEmitter) }),
      });
      return Object.freeze({
        result,
        async applyTo(target: C) {
          if (target !== context) {
            throw new AgentRunError(
              'WORKFLOW_RESULT_CONTEXT_MISMATCH',
              `Workflow result from "${workflow.name}" belongs to another Agent Run.`,
              workflow.name
            );
          }
          await applyResult(context, result);
        },
      });
    },
  });
}
