import {
  createActorCatalog,
  createResponsibilityCatalog,
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import { MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  type ActorDirectHandler,
  type ActorEngineDirectRequest,
  type AssistantModelMessage,
  type TokenCounter,
  type TextTokenInput,
} from '@print-an-agent/model-invocation-core';
import {
  DEFAULT_SESSION_COMPACTION_POLICY,
  supportsSessionExecution,
  parseTurnId,
  type CompactableSessionPort,
  type SessionCompactionPolicy,
} from '@print-an-agent/base-session';
import { composeAgent, type ComposeAgentOptions } from '../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from './compaction-token-counter.js';

export function compactionMessage(
  text: string,
  stopReason: AssistantModelMessage['stopReason'] = 'stop'
): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    stopReason,
    timestamp: 1,
    provenance: defineProviderModelExecutionProvenance({ provider: 'test', model: 'test' }),
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
  });
}

export async function seedCompactionSession(
  session: CompactableSessionPort,
  identity: ReturnType<typeof defineAgentIdentity>
) {
  const reference = await session.resolve({ agentId: identity.id });
  const execution = supportsSessionExecution(session)
    ? await session.acquireSessionExecution(reference)
    : undefined;
  try {
    for (let index = 1; index <= 4; index++) {
      const resolved = await session.resolve(reference);
      const turnId = parseTurnId(`turn-${index}`);
      await session.beginTurn({
        ...resolved,
        ...(execution === undefined ? {} : { execution }),
        turnId,
        userMessage: { role: 'user', text: `original-fact-${index}`, timestamp: index },
      });
      await session.completeTurn({
        ...reference,
        ...(execution === undefined ? {} : { execution }),
        turnId,
        assistantMessage: compactionMessage(`answer-${index}`),
      });
    }
  } finally {
    if (execution !== undefined && supportsSessionExecution(session))
      await session.releaseSessionExecution(execution);
  }
  return reference;
}

export async function compactionFixture(
  options: {
    readonly complete?: ActorDirectHandler;
    readonly policy?: Partial<SessionCompactionPolicy>;
    readonly counter?: TokenCounter<TextTokenInput> | false;
    readonly steps?: ComposeAgentOptions['sessionCompactionStepOverrides'];
    readonly session?: CompactableSessionPort;
    readonly actorTimeoutMilliseconds?: number;
  } = {}
) {
  const identity = defineAgentIdentity({ id: 'compactor' });
  const session = options.session ?? new MemorySessionAdapter();
  const reference = await seedCompactionSession(session, identity);
  const requests: ActorEngineDirectRequest[] = [];
  const agent = composeAgent({
    identity,
    session,
    actorCatalog: createActorCatalog({
      actors: [
        {
          id: MAIN_ACTOR_ID,
          engineId: 'compaction-engine',
          ...(options.actorTimeoutMilliseconds === undefined
            ? {}
            : { invocationPolicy: { timeoutMilliseconds: options.actorTimeoutMilliseconds } }),
        },
      ],
      engines: [
        {
          id: 'compaction-engine',
          capabilities: {
            invocationModes: ['direct'],
            inputMediaTypes: ['text'],
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          complete: (request) => {
            requests.push(request);
            return (
              options.complete?.(request) ??
              Promise.resolve({ message: compactionMessage('summary') })
            );
          },
        },
      ],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
    sessionCompactionPolicy: { ...DEFAULT_SESSION_COMPACTION_POLICY, ...options.policy },
    ...(options.counter === false
      ? {}
      : {
          sessionCompactionTokenCounter: options.counter ?? TEST_COMPACTION_TOKEN_COUNTER,
        }),
    ...(options.steps === undefined ? {} : { sessionCompactionStepOverrides: options.steps }),
  });
  return { agent, session, reference, requests, sessionId: reference.sessionId };
}
