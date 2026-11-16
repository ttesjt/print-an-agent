import { Workflow } from '@print-an-agent/workflow-core';
import { finalizeSessionExecution } from '../../lifecycle/workflow-execution.js';
import { AgentSessionError } from '../../errors.js';
import { SESSION_COMPACTION_WORKFLOW_NAME } from './names.js';
import { createSessionCompactionStepDefinitions } from './step-definitions.js';
import { validateSessionCompactionPolicy } from '../policy.js';
import { bindSessionCompactionTokenCounter } from '../planning/measurement.js';
import type {
  CreateSessionCompactionWorkflowOptions,
  SessionCompactionWorkflowContext,
} from './types.js';

export function createSessionCompactionWorkflow(options: CreateSessionCompactionWorkflowOptions) {
  return new Workflow({
    ...options,
    resources: Object.freeze({
      ...options.resources,
      policy: validateSessionCompactionPolicy(options.resources.policy),
      ...(options.resources.tokenCounter === undefined
        ? {}
        : {
            tokenCounter: bindSessionCompactionTokenCounter(options.resources.tokenCounter),
          }),
    }),
    name: SESSION_COMPACTION_WORKFLOW_NAME,
    entryStep: 'runSessionCompaction',
    stepDefinitions: createSessionCompactionStepDefinitions(),
    createResult: () => undefined,
    createState: ({ input }): SessionCompactionWorkflowContext['state'] => ({ agentRun: input }),
    lifecycle: {
      ...options.lifecycle,
      async onSuccess(context: SessionCompactionWorkflowContext) {
        await options.lifecycle?.onSuccess?.(context);
        if (context.result === undefined)
          throw new AgentSessionError(
            'SESSION_COMPACTION_INVALID',
            'Compaction completed without a result.'
          );
      },
      async onFinally(context) {
        // A failed product cleanup retains occupancy for explicit recovery.
        await options.lifecycle?.onFinally?.(context);
        await finalizeSessionExecution({
          resources: context.resources,
          ...(context.state.execution === undefined ? {} : { execution: context.state.execution }),
        });
      },
    },
  });
}
