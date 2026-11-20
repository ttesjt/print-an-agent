import { bindAgentWorkflow } from '@print-an-agent/base-runtime';
import {
  createDefaultSessionCompactionStepOverrides,
  createSessionCompactionWorkflow,
  createShouldCompactSessionCondition,
  type SessionCompactionResources,
} from '@print-an-agent/base-session';
import { mergeStepOverrides } from '@print-an-agent/workflow-core';
import type { ComposeAgentOptions } from './types/options.js';
import type { SessionCompactionAgentRunContext } from './types/run-context.js';

export function composeCompactionWorkflow<R extends SessionCompactionResources>(
  options: ComposeAgentOptions,
  compactionResources: R
) {
  return (
    options.sessionCompactionWorkflow ??
    bindAgentWorkflow({
      projectInput: (context: SessionCompactionAgentRunContext) => ({
        agentId: context.identity.id,
        compactionInput: context.input,
        ...(context.traceEmitter === undefined ? {} : { traceEmitter: context.traceEmitter }),
      }),
      workflow: createSessionCompactionWorkflow({
        resources: compactionResources,
        stepOverrides: mergeStepOverrides(
          createDefaultSessionCompactionStepOverrides(),
          options.sessionCompactionStepOverrides
        ),
        condition: options.sessionCompactionCondition ?? createShouldCompactSessionCondition(),
        ...(options.createCompactionWorkflowRunId === undefined
          ? {}
          : { createRunId: options.createCompactionWorkflowRunId }),
      }),
      applyResult(context, result) {
        if (result !== undefined) context.output = result;
      },
    })
  );
}
