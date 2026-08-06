import { defineAgentIdentity } from '@ta-agent/base-identity';
import { AgentModelError } from '@ta-agent/base-model';
import {
  AgentRequestError,
  createDefaultRequestStepOverrides,
  createRequestWorkflow,
  DEFAULT_REQUEST_POLICY,
  failRequest,
  MemoryOutputSink,
  REQUEST_WORKFLOW_NAME,
  validateRequestPolicy,
  type AgentRequestInput,
  type AgentResponse,
  type DefaultRequestWorkflowContext,
  type RequestAgentContext,
  type RequestPolicy,
  type RequestStepName,
  type RequestWorkflowName,
} from '@ta-agent/base-request';
import { MemorySessionAdapter } from '@ta-agent/base-session';
import { createAgent, type StepOverride, type StepOverrides } from '@ta-agent/base-workflow';
import type { AgentBaseRunOptions, AssembleAgentBaseOptions, AssembledAgentBase } from './types.js';

const DEFAULT_INSTRUCTIONS = 'Respond helpfully and concisely.';

function mergeStepOverrides(
  overrides: StepOverrides<RequestStepName, DefaultRequestWorkflowContext> | undefined
): StepOverrides<RequestStepName, DefaultRequestWorkflowContext> {
  const merged = {
    ...createDefaultRequestStepOverrides(),
  } as Record<RequestStepName, StepOverride<DefaultRequestWorkflowContext>>;
  if (overrides !== undefined) {
    for (const stepName of Object.keys(overrides) as RequestStepName[]) {
      const override = overrides[stepName];
      if (override !== undefined) merged[stepName] = override;
    }
  }
  return Object.freeze(merged);
}

export function assembleAgentBase(options: AssembleAgentBaseOptions): AssembledAgentBase {
  const identity = defineAgentIdentity(options.identity);
  const session = options.session ?? new MemorySessionAdapter();
  const requestPolicy = validateRequestPolicy(options.requestPolicy ?? DEFAULT_REQUEST_POLICY);
  const resources = Object.freeze({
    session,
    modelRuntime: options.modelRuntime,
    modelReference: options.modelReference,
    instructionContributors: Object.freeze(
      options.instructionContributors ?? [() => DEFAULT_INSTRUCTIONS]
    ),
    createOutputSink: options.createOutputSink ?? (() => new MemoryOutputSink()),
    clock: options.clock ?? Date.now,
  });
  const requestWorkflow =
    options.requestWorkflow ??
    createRequestWorkflow<RequestAgentContext, AgentResponse, DefaultRequestWorkflowContext>({
      stepOverrides: mergeStepOverrides(options.stepOverrides),
      createContext: (base) => ({
        ...base,
        resources,
        policy: requestPolicy,
      }),
      lifecycle: { onError: failRequest },
      applyResult: (agentContext, result) => {
        agentContext.output = result;
        return Promise.resolve();
      },
      ...(options.createWorkflowRunId === undefined
        ? {}
        : { createRunId: options.createWorkflowRunId }),
    });
  const agent = createAgent<
    RequestWorkflowName,
    AgentRequestInput,
    AgentResponse,
    RequestPolicy,
    typeof resources,
    RequestAgentContext
  >({
    identity,
    config: requestPolicy,
    resources,
    workflowPlan: [REQUEST_WORKFLOW_NAME],
    workflowDefinitions: {
      [REQUEST_WORKFLOW_NAME]: { workflow: requestWorkflow, skippable: false },
    },
    createContext: (base): RequestAgentContext => ({ ...base }),
    ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
  });

  return Object.freeze({
    identity,
    session,
    modelRuntime: options.modelRuntime,
    modelReference: options.modelReference,
    requestPolicy,
    async run(input: AgentRequestInput, runOptions: AgentBaseRunOptions = {}) {
      const timeoutSignal = AbortSignal.timeout(requestPolicy.timeoutMilliseconds);
      const signal =
        runOptions.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([runOptions.signal, timeoutSignal]);
      try {
        return await agent.run(input, { signal });
      } catch (error: unknown) {
        if (
          error instanceof AgentModelError &&
          (error.code === 'MODEL_INVOCATION_CANCELLED' ||
            error.code === 'MODEL_INVOCATION_TIMEOUT') &&
          timeoutSignal.aborted &&
          !runOptions.signal?.aborted
        ) {
          throw new AgentRequestError(
            'REQUEST_TIMEOUT',
            `Request exceeded ${requestPolicy.timeoutMilliseconds} milliseconds.`,
            { cause: error }
          );
        }
        throw error;
      }
    },
  });
}
