import { createResponsibilityRouter, MAIN_ACTOR_ID } from '@print-an-agent/base-actor';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  createMemorySessionPersistence,
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@print-an-agent/base-local-adapters';
import { NOOP_AGENT_TRACE_SINK } from '@print-an-agent/base-observability';
import { DEFAULT_REQUEST_POLICY, validateRequestPolicy } from '@print-an-agent/base-request';
import {
  bindSessionCompactionTokenCounter,
  DEFAULT_SESSION_COMPACTION_POLICY,
  validateSessionCompactionPolicy,
} from '@print-an-agent/base-session';
import {
  DEFAULT_TOOL_EXECUTION_POLICY,
  EMPTY_TOOL_REGISTRY,
  validateToolExecutionPolicy,
} from '@print-an-agent/base-tool';
import type { ActorId } from '@print-an-agent/model-invocation-core';
import { composeCompactionWorkflow } from './compaction-binding.js';
import { resolveConsumerTokenCounter } from './consumer-token-counter.js';
import { DEFAULT_COMPACTION_INSTRUCTIONS, DEFAULT_INSTRUCTIONS } from './defaults.js';
import {
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
} from './names.js';
import { createCompactionOperation } from './operations/compaction.js';
import { createForegroundOperation } from './operations/foreground.js';
import { composeRequestWorkflow } from './request-binding.js';
import type { ComposeAgentOptions } from './types/options.js';
import { parseToolAllowList, validateCompactionInstructions } from './validation.js';

export function createStandardAgentDefinition(options: ComposeAgentOptions) {
  const identity = defineAgentIdentity(options.identity);
  const persistence =
    options.session === undefined && options.requestJournal === undefined
      ? createMemorySessionPersistence(options.clock === undefined ? {} : { clock: options.clock })
      : undefined;
  const session = options.session ?? persistence?.session ?? new MemorySessionAdapter();
  const requestJournal =
    options.requestJournal ??
    persistence?.requestJournal ??
    new MemoryRequestJournalAdapter(options.clock);
  const requestPolicy = validateRequestPolicy(options.requestPolicy ?? DEFAULT_REQUEST_POLICY);
  const toolRegistry = options.toolRegistry ?? EMPTY_TOOL_REGISTRY;
  const productToolAllowList = parseToolAllowList(options.productToolAllowList);
  const runtimeToolAllowList = parseToolAllowList(options.runtimeToolAllowList);
  const toolExecutionPolicy = validateToolExecutionPolicy(
    options.toolExecutionPolicy ?? DEFAULT_TOOL_EXECUTION_POLICY
  );
  const traceSink = options.observability?.sink ?? NOOP_AGENT_TRACE_SINK;
  const mainActorId: ActorId = options.mainActorId ?? MAIN_ACTOR_ID;
  const responsibilityRouter = createResponsibilityRouter({
    actorCatalog: options.actorCatalog,
    responsibilityCatalog: options.responsibilityCatalog,
    mainActorId,
  });
  const resources = Object.freeze({
    ...(options.contextMemory === undefined ? {} : { contextMemory: options.contextMemory }),
    session,
    requestJournal,
    responsibilities: responsibilityRouter,
    instructionContributors: Object.freeze(
      options.instructionContributors ?? [() => DEFAULT_INSTRUCTIONS]
    ),
    toolRegistry,
    productToolAllowList,
    runtimeToolAllowList,
    toolExecutionPolicy,
    createOutputSink: options.createOutputSink ?? (() => new MemoryOutputSink()),
    clock: options.clock ?? Date.now,
  });
  const requestWorkflow = composeRequestWorkflow(options, resources, requestPolicy);
  const foregroundOperation = createForegroundOperation(
    options,
    resources,
    requestPolicy,
    requestWorkflow
  );

  const compactionPolicy = validateSessionCompactionPolicy(
    options.sessionCompactionPolicy ?? DEFAULT_SESSION_COMPACTION_POLICY
  );
  const compactionInstructions = validateCompactionInstructions(
    options.sessionCompactionInstructions ?? DEFAULT_COMPACTION_INSTRUCTIONS
  );
  const compactionResources = Object.freeze({
    session,
    responsibilities: responsibilityRouter,
    instructions: compactionInstructions,
    policy: compactionPolicy,
    clock: options.clock ?? Date.now,
    ...(options.sessionCompactionTokenCounter === undefined
      ? {
          resolveTokenCounter: (signal: AbortSignal) =>
            resolveConsumerTokenCounter(responsibilityRouter, signal),
        }
      : {
          tokenCounter: bindSessionCompactionTokenCounter(options.sessionCompactionTokenCounter),
        }),
  });
  const compactionWorkflow = composeCompactionWorkflow(options, compactionResources);
  const compactionOperation = createCompactionOperation(
    options,
    compactionResources,
    compactionPolicy,
    session,
    compactionWorkflow
  );

  const agentResources = Object.freeze({
    session,
    requestJournal,
    responsibilities: responsibilityRouter,
    toolRegistry,
  });
  return Object.freeze({
    identity,
    resources: agentResources,
    operations: Object.freeze({
      [FOREGROUND_AGENT_OPERATION_NAME]: foregroundOperation,
      [SESSION_COMPACTION_AGENT_OPERATION_NAME]: compactionOperation,
    }),
    observability: Object.freeze({ ...options.observability, sink: traceSink }),
  });
}

export type StandardAgentDefinition = ReturnType<typeof createStandardAgentDefinition>;
export type StandardAgentResources = StandardAgentDefinition['resources'];
export type StandardAgentOperations = StandardAgentDefinition['operations'];
