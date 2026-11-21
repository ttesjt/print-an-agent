import { createProviderRuntime, type ProviderRuntime } from '@print-an-agent/base-composition';
import { createAgentActorCatalog, MAIN_ACTOR_ID } from '@print-an-agent/agent-actor';
import {
  requireCompletionCapability,
  type ActorEngine,
} from '@print-an-agent/model-invocation-core';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { AgentConfigValidationError } from '../../application/agent-config-validation.js';

export interface WebModelHost {
  /** Explicit host-installed custom Engine, used by deterministic qualification profiles. */
  readonly engine?: ActorEngine;
  readonly readEnvironmentVariable?: (name: string) => string | undefined;
}
export class WebModelError extends Error {
  readonly code = 'WEB_MODEL_UNAVAILABLE';
}
export function actorInvocation(config: AgentWebConfig) {
  return {
    ...(config.invocation.temperature === null
      ? {}
      : { temperature: config.invocation.temperature }),
    ...(config.invocation.maxOutputTokens === null
      ? {}
      : { maxOutputTokens: config.invocation.maxOutputTokens }),
  };
}
export function webActorInstructions(config: AgentWebConfig): string {
  return `${config.instructions}\nResponse style: ${config.responseStyle}.`;
}
export function createWebModelRuntime(
  config: AgentWebConfig,
  host: WebModelHost
): {
  readonly engine: ActorEngine;
  readonly provider?: ProviderRuntime;
} {
  const binding = config.model;
  if (binding.kind === 'unconfigured')
    throw new WebModelError('Configure a model in Agent Settings.');
  if (binding.kind === 'engine') {
    if (host.engine?.id !== binding.engineId)
      throw new WebModelError('The configured Engine is not installed in this host.');
    return { engine: host.engine };
  }
  let provider: ProviderRuntime;
  try {
    const credential = binding.credential;
    provider = createProviderRuntime({
      config: binding.config,
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: config.execution.responseStartTimeoutMilliseconds,
        streamEventIdleTimeoutMilliseconds: config.execution.streamEventIdleTimeoutMilliseconds,
      },
      ...(credential === null
        ? {}
        : {
            credentialResolver: {
              resolve: ({ reference, signal }) => {
                signal.throwIfAborted();
                const apiKey =
                  reference === credential.reference
                    ? host.readEnvironmentVariable?.(credential.environmentVariable)
                    : undefined;
                return Promise.resolve(
                  apiKey === undefined || apiKey.length === 0
                    ? undefined
                    : { type: 'api-key' as const, apiKey }
                );
              },
            },
          }),
    });
  } catch {
    throw new AgentConfigValidationError([
      { field: 'model', message: 'Provider/model target is unsupported or invalid.' },
    ]);
  }
  if (
    config.invocation.maxOutputTokens !== null &&
    config.invocation.maxOutputTokens > provider.inspect().maxOutputTokens
  ) {
    throw new AgentConfigValidationError([
      {
        field: 'actorMaxOutputTokens',
        message: 'Invocation output limit exceeds model capability.',
      },
    ]);
  }
  return { engine: provider.actorEngine, provider };
}
export function validateWebModelConfig(config: AgentWebConfig, host: WebModelHost): void {
  if (config.model.kind !== 'unconfigured') createWebModelRuntime(config, host);
}
export async function assertWebModelReady(
  config: AgentWebConfig,
  host: WebModelHost,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const runtime = createWebModelRuntime(config, host);
  if (
    runtime.provider !== undefined &&
    (await runtime.provider.checkReadiness(signal === undefined ? {} : { signal })).status !==
      'ready'
  )
    throw new WebModelError(
      'The configured server credential is unavailable. Check Agent Settings.'
    );
}
const CONNECTION_TEST_TIMEOUT_MILLISECONDS = 30_000;
const CONNECTION_TEST_MAX_OUTPUT_TOKENS = 16;
/** Explicit user-triggered probe; never writes Session/Journal or returns model output. */
export async function testWebModelConnection(
  config: AgentWebConfig,
  host: WebModelHost,
  signal: AbortSignal
) {
  await assertWebModelReady(config, host, signal);
  const { engine, provider } = createWebModelRuntime(config, host);
  const actor = await createAgentActorCatalog({
    engines: [engine],
    actors: [
      {
        id: MAIN_ACTOR_ID,
        engineId: engine.id,
        instructions: config.instructions,
        invocationConfig: {
          ...actorInvocation(config),
          maxOutputTokens: Math.min(
            config.invocation.maxOutputTokens ?? CONNECTION_TEST_MAX_OUTPUT_TOKENS,
            CONNECTION_TEST_MAX_OUTPUT_TOKENS,
            provider?.inspect().maxOutputTokens ?? CONNECTION_TEST_MAX_OUTPUT_TOKENS
          ),
        },
        invocationPolicy: {
          timeoutMilliseconds: Math.min(
            config.execution.actorTimeoutMilliseconds ?? CONNECTION_TEST_TIMEOUT_MILLISECONDS,
            CONNECTION_TEST_TIMEOUT_MILLISECONDS
          ),
        },
      },
    ],
  }).resolve(MAIN_ACTOR_ID);
  await requireCompletionCapability(actor).complete({
    instructions: '',
    messages: [{ role: 'user', text: 'Reply OK.', timestamp: Date.now() }],
    maxOutputCharacters: 4096,
    signal,
  });
  signal.throwIfAborted();
}
