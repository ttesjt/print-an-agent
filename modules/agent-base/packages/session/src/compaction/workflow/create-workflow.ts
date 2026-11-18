import { Workflow, RUN_WORKFLOW } from '@print-an-agent/workflow-core';
import { finalizeSessionExecution } from '../../lifecycle/workflow-execution.js';
import { AgentSessionError } from '../../errors.js';
import { SESSION_COMPACTION_WORKFLOW_NAME } from './names.js';
import { createSessionCompactionStepDefinitions } from './step-definitions.js';
import { defineCompactSessionInput } from '../input.js';
import { validateSessionCompactionPolicy } from '../policy.js';
import { bindSessionCompactionTokenCounter } from '../planning/measurement.js';
import type {
  CreateSessionCompactionWorkflowOptions,
  SessionCompactionWorkflowContext,
  SessionCompactionDefinition,
  SessionCompactionWorkflowInput,
} from './types.js';

function normalizeWorkflowInput(
  input: SessionCompactionWorkflowInput
): SessionCompactionWorkflowInput {
  return {
    agentId: input.agentId,
    compactionInput: defineCompactSessionInput(input.compactionInput),
    ...(input.traceEmitter === undefined ? {} : { traceEmitter: input.traceEmitter }),
  };
}

export function createSessionCompactionWorkflow(options: CreateSessionCompactionWorkflowOptions) {
  const condition = options.condition;
  const definition: SessionCompactionDefinition = {
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
    createSkippedResult: () => undefined,
    createResult(state) {
      if (state.outcome === undefined)
        throw new AgentSessionError(
          'SESSION_COMPACTION_INVALID',
          'Compaction completed without a result.'
        );
      return state.outcome;
    },
    // Admission validation must precede even a custom condition or a condition skip.
    condition: (inputs) => {
      const input = normalizeWorkflowInput(inputs.input);
      return condition?.({ ...inputs, input }) ?? RUN_WORKFLOW;
    },
    // Revalidate before state creation: caller data may change while an async condition settles.
    createState: ({ input }): SessionCompactionWorkflowContext['state'] =>
      normalizeWorkflowInput(input),
    lifecycle: {
      ...options.lifecycle,
      async onFinally(context) {
        // A failed product cleanup retains occupancy for explicit recovery.
        await options.lifecycle?.onFinally?.(context);
        await finalizeSessionExecution({
          resources: context.resources,
          ...(context.state.execution === undefined ? {} : { execution: context.state.execution }),
        });
      },
    },
  };
  return new Workflow(definition);
}
