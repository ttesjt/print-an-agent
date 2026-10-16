import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
  type ActorInteractionHandler,
} from '@ta-agent/base-actor';
import {
  MemoryAgentTraceAdapter,
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@ta-agent/base-local-adapters';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@ta-agent/base-model';
import {
  createDefaultRequestStepOverrides,
  type DefaultRequestWorkflowContext,
  type RequestStepName,
} from '@ta-agent/base-request';
import type { Step } from '@ta-agent/workflow-core';
import { createAgent } from '@ta-agent/base-runtime';
import {
  createStandardAgentDefinition,
  FOREGROUND_AGENT_OPERATION_NAME,
  type ComposeAgentOptions,
} from '../../src/index.js';

export function interactionMessage(text = 'AB') {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.interaction',
      evidence: {},
    }),
    stopReason: 'stop',
    timestamp: 1,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
  });
}

export function defaultRequestStep(name: RequestStepName): Step<DefaultRequestWorkflowContext> {
  const step = createDefaultRequestStepOverrides()[name];
  if (typeof step !== 'function') throw new Error('Expected an installed function Step.');
  return step;
}

export async function interactionAgent(
  interact: ActorInteractionHandler,
  options: Partial<ComposeAgentOptions> = {},
  createWorkflow?: (
    resources: DefaultRequestWorkflowContext['resources']
  ) => NonNullable<ComposeAgentOptions['requestWorkflow']>
) {
  const session = new MemorySessionAdapter({ createSessionId: () => 'session' });
  const journal = new MemoryRequestJournalAdapter();
  const output = new MemoryOutputSink();
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 512 });
  const actorCatalog = createActorCatalog({
    actors: [{ id: MAIN_ACTOR_ID, engineId: 'test-engine' }],
    engines: [
      {
        id: 'test-engine',
        capabilities: {
          invocationModes: ['interaction'],
          inputMediaTypes: ['text'],
          interaction: { streamable: true },
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        },
        interact,
      },
    ],
  });
  const definition = createStandardAgentDefinition({
    identity: { id: 'interaction-agent' },
    actorCatalog,
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
    session,
    requestJournal: journal,
    observability: { sink: trace, clock: () => 1 },
    createRunId: () => 'interaction-run',
    ...options,
  });
  const foreground = definition.operations.foreground;
  const requestWorkflow = createWorkflow?.(
    Object.freeze({ ...foreground.resources, policy: foreground.config })
  );
  const agent = createAgent({
    ...definition,
    operations: {
      ...definition.operations,
      foreground:
        requestWorkflow === undefined
          ? foreground
          : { ...foreground, workflowPlan: [requestWorkflow] },
    },
  });
  const { sessionId } = await (options.session ?? session).resolve({ agentId: agent.identity.id });
  return {
    agent,
    session,
    journal,
    output,
    trace,
    run: (signal?: AbortSignal) =>
      agent.invoke(
        FOREGROUND_AGENT_OPERATION_NAME,
        {
          message: 'start',
          sessionId,
          idempotencyKey: 'request',
          outputSink: output,
        },
        signal === undefined ? undefined : { signal }
      ),
  };
}
