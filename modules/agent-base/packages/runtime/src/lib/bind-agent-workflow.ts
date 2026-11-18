import { isPromise } from 'node:util/types';
import { traceErrorCode } from '@print-an-agent/base-observability';
import type { AnyAgentRunContext } from '../types/context.js';
import type { AgentWorkflow, AgentWorkflowBinding } from '../types/workflow.js';
import { AgentDefinitionError, AgentRunError } from '../types/errors.js';
import { createWorkflowTraceObserver } from './workflow-tracing.js';

function requireSynchronousInput<TInput>(input: TInput, workflowName: string): TInput {
  if (isPromise(input)) {
    // Observe native rejections immediately, including across realms. Do not await an invalid
    // projection or access a Promise's possibly overridden then property.
    void Promise.prototype.then.call(
      input,
      () => undefined,
      () => undefined
    );
  } else if (
    !((typeof input === 'object' && input !== null) || typeof input === 'function') ||
    typeof Reflect.get(input, 'then') !== 'function'
  ) {
    return input;
  }
  throw new AgentRunError(
    'WORKFLOW_INPUT_PROJECTION_ASYNC',
    'Workflow input projection must return a synchronous value.',
    workflowName
  );
}

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
