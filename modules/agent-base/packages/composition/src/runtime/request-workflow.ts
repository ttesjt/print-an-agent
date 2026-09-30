import {
  createDefaultRequestStepOverrides,
  createRequestStepDefinitions,
  createRequestWorkflow,
  failRequest,
  releaseRequestExecution,
  type AgentResponse,
  type DefaultRequestWorkflowContext,
  type RequestAgentRunContext,
  type RequestPolicy,
  type RequestRuntimeResources,
} from '@ta-agent/base-request';
import { AgentSessionError, supportsSessionPresentation } from '@ta-agent/base-session';
import { mergeStepOverrides, resolveStepRegistry } from '@ta-agent/base-workflow';
import type { ComposeAgentOptions } from './types.js';

/** Validate installed capability dependencies without adding a second feature/config registry. */
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
      createRequestStepDefinitions<
        RequestAgentRunContext,
        AgentResponse,
        DefaultRequestWorkflowContext
      >(),
      stepOverrides
    );
    if (resolved.captureReasoningPresentation.status === 'active') {
      throw new AgentSessionError(
        'SESSION_PRESENTATION_NOT_CONFIGURED',
        'Reasoning capture requires a Session presentation adapter or an explicit SKIP_STEP.'
      );
    }
  }
  return createRequestWorkflow<
    RequestAgentRunContext,
    AgentResponse,
    DefaultRequestWorkflowContext
  >({
    stepOverrides,
    createContext: (base) => ({ ...base, resources, policy }),
    lifecycle: { onError: failRequest, onFinally: releaseRequestExecution },
    applyResult: (agentRunContext, result) => {
      agentRunContext.output = result;
      return Promise.resolve();
    },
    ...(options.createWorkflowRunId === undefined
      ? {}
      : { createRunId: options.createWorkflowRunId }),
  });
}
