import { AgentRequestError, type RequestPolicy } from '@print-an-agent/base-request';
import { defineAgentOperation } from '@print-an-agent/base-runtime';
import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import { FOREGROUND_AGENT_OPERATION_NAME } from '../names.js';
import { composeRequestWorkflow } from '../request-binding.js';
import type { NoCallableAgentOperations } from '../types/operations.js';
import type { ComposeAgentOptions } from '../types/options.js';
import type { RequestAgentRunContext } from '../types/run-context.js';

export function createForegroundOperation<R extends object>(
  options: ComposeAgentOptions,
  resources: R,
  requestPolicy: RequestPolicy,
  requestWorkflow: ReturnType<typeof composeRequestWorkflow>
) {
  return defineAgentOperation<
    typeof FOREGROUND_AGENT_OPERATION_NAME,
    'public',
    RequestPolicy,
    typeof resources,
    NoCallableAgentOperations,
    RequestAgentRunContext
  >({
    name: FOREGROUND_AGENT_OPERATION_NAME,
    exposure: 'public',
    config: requestPolicy,
    resources,
    workflowPlan: [requestWorkflow],
    executeRun: ({ signal, config, execute }) =>
      runWithExecutionTimeout(
        {
          parentSignal: signal,
          timeoutMilliseconds: config.timeoutMilliseconds,
          createTimeoutFailure: ({ timeoutMilliseconds, cause }) =>
            new AgentRequestError(
              'REQUEST_TIMEOUT',
              `Request execution exceeded ${timeoutMilliseconds} milliseconds.`,
              { cause }
            ),
        },
        execute
      ),
    createContext: (base): RequestAgentRunContext => ({ ...base }),
    ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
  });
}
