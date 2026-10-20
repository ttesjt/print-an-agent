import { createActor, type ModelMessage } from '@ta-agent/model-invocation-core';
import type { ManagedAgentSnapshot } from '@ta-agent/base-composition';
import type { SessionlessOutputSink } from '@ta-agent/base-request';
import type { AgentWebConfig } from '../../../application/agent-config.js';
import type { TemporaryHistoryPair } from '../../../temporary-conversation/contracts.js';
import {
  actorInvocation,
  createWebModelRuntime,
  webActorInstructions,
  WebModelError,
  type WebModelHost,
} from '../model-runtime.js';

export interface TemporaryResourceTarget {
  readonly snapshot: ManagedAgentSnapshot<AgentWebConfig>;
  readonly sink: SessionlessOutputSink;
}
export async function resolveTemporaryResources(
  target: TemporaryResourceTarget,
  signal: AbortSignal,
  host: WebModelHost
) {
  const config = target.snapshot.config.value;
  const { engine, provider } = createWebModelRuntime(config, host);
  if (provider !== undefined && (await provider.checkReadiness({ signal })).status !== 'ready') {
    throw new WebModelError('The configured credential is unavailable.');
  }
  signal.throwIfAborted();
  return {
    actor: createActor({
      id: 'temporary-response',
      engine,
      instructions: webActorInstructions(config),
      invocationConfig: actorInvocation(config),
      invocationPolicy: { timeoutMilliseconds: config.execution.actorTimeoutMilliseconds },
    }),
    // This target is created for exactly one private port invocation, never cached or shared.
    createOutputSink: () => target.sink,
  };
}
export function temporaryModelHistory(
  history: readonly TemporaryHistoryPair[]
): readonly ModelMessage[] {
  return history.length === 0
    ? []
    : [
        Object.freeze({
          role: 'context',
          text: JSON.stringify({ kind: 'caller-provided-temporary-transcript', turns: history }),
          timestamp: Date.now(),
        }),
      ];
}
