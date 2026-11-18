import {
  createDefaultRequestState,
  createDefaultRequestStepOverrides,
  createRequestStepDefinitions,
  createRequestWorkflow,
  failRequest,
  releaseRequestExecution,
  type AgentResponse,
  type DefaultRequestWorkflowContext,
  type RequestWorkflowInput,
  type RequestPolicy,
  type RequestRuntimeResources,
} from '@print-an-agent/base-request';
import { AgentSessionError, supportsSessionPresentation } from '@print-an-agent/base-session';
import { bindAgentWorkflow } from '@print-an-agent/base-runtime';
import { mergeStepOverrides, resolveStepRegistry } from '@print-an-agent/workflow-core';
import type { ComposeAgentOptions, RequestAgentRunContext } from './types.js';

export function composeRequestWorkflow(
  options: ComposeAgentOptions,
  resources: RequestRuntimeResources,
  policy: RequestPolicy
) {
  if (options.requestWorkflow !== undefined) return options.requestWorkflow;
  const stepOverrides = mergeStepOverrides(
    createDefaultRequestStepOverrides(),
    options.stepOverrides
  );
  if (!supportsSessionPresentation(resources.session)) {
    const resolved = resolveStepRegistry(
      createRequestStepDefinitions<DefaultRequestWorkflowContext>(),
      stepOverrides
    );
    if (resolved.captureReasoningPresentation.status === 'active') {
      throw new AgentSessionError(
        'SESSION_PRESENTATION_NOT_CONFIGURED',
        'Reasoning capture requires a Session presentation adapter or an explicit SKIP_STEP.'
      );
    }
  }
  const workflow = createRequestWorkflow<
    RequestWorkflowInput,
    DefaultRequestWorkflowContext['state'],
    DefaultRequestWorkflowContext['resources'],
    AgentResponse
  >({
    resources: Object.freeze({ ...resources, policy }),
    stepOverrides,
    createState: ({ input }) => createDefaultRequestState(input),
    lifecycle: { onError: failRequest, onFinally: releaseRequestExecution },
    ...(options.createWorkflowRunId === undefined
      ? {}
      : { createRunId: options.createWorkflowRunId }),
  });
  return bindAgentWorkflow({
    projectInput: (context: RequestAgentRunContext) => ({
      agentId: context.identity.id,
      requestId: context.runId,
      requestInput: context.input,
      ...(context.traceEmitter === undefined ? {} : { traceEmitter: context.traceEmitter }),
    }),
    workflow,
    applyResult(context, result) {
      // Undefined is the explicit no-change result of a condition skip.
      if (result !== undefined) context.output = result;
    },
  });
}
