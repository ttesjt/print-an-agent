import { composeAgent, createProviderRuntime } from '@ta-agent/base-composition';
import {
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
  createActorCatalog,
  createResponsibilityCatalog,
} from '@ta-agent/base-actor';
import type { AgentIdentity } from '@ta-agent/base-identity';
import type { RequestJournalPort } from '@ta-agent/base-request';
import type { CompactableSessionPort } from '@ta-agent/base-session';
import { createStandaloneCredentialResolver } from '../credential-resolver.js';
import { AgentBaseStandaloneError } from '../errors.js';
import { resolveStandaloneTextTokenCounter } from './token-counter.js';
import {
  resolveStandaloneRequestPolicy,
  resolveStandaloneSessionCompactionPolicy,
} from '../runtime-policies.js';
import type {
  StandaloneRawAgent,
  StandaloneAgentConfig,
  StandaloneRuntimeOptions,
} from '../types.js';

export interface StandaloneRuntimePorts {
  readonly session: CompactableSessionPort;
  readonly requestJournal: RequestJournalPort;
}

export interface StandaloneRuntimeMaterializationInput {
  readonly identity: AgentIdentity;
  readonly config: StandaloneAgentConfig;
  readonly ports: StandaloneRuntimePorts;
  readonly options: StandaloneRuntimeOptions;
}

/** Pure runtime assembly over explicitly provisioned, complete persistence Ports. */
export function materializeStandaloneAgentRuntime(
  input: StandaloneRuntimeMaterializationInput
): StandaloneRawAgent {
  if (input.ports?.session == null || input.ports.requestJournal == null) {
    throw new AgentBaseStandaloneError(
      'Standalone materialization requires complete persistence Ports.'
    );
  }
  const credentialResolver =
    input.config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(input.config.credential, input.options);

  const textTokenCounter = resolveStandaloneTextTokenCounter(input.config.provider, input.options);
  const provider = createProviderRuntime({
    ...(textTokenCounter === undefined ? {} : { textTokenCounter }),
    config: input.config.provider.config,
    transportLivenessPolicy: input.config.provider.transportLivenessPolicy,
    ...(credentialResolver === undefined ? {} : { credentialResolver }),
  });
  return composeAgent({
    identity: input.identity,
    actorCatalog: createActorCatalog({
      actors: [{ ...input.config.mainActor, id: MAIN_ACTOR_ID, engineId: provider.actorEngine.id }],
      engines: [provider.actorEngine],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
    session: input.ports.session,
    requestJournal: input.ports.requestJournal,
    ...(input.options.stepOverrides === undefined
      ? {}
      : { stepOverrides: input.options.stepOverrides }),
    requestPolicy: resolveStandaloneRequestPolicy(
      input.config.request,
      input.options.requestLimits
    ),
    sessionCompactionPolicy: resolveStandaloneSessionCompactionPolicy(
      input.config.sessionCompaction
    ),
    ...(input.options.sessionCompactionTokenCounter === undefined
      ? {}
      : {
          sessionCompactionTokenCounter: input.options.sessionCompactionTokenCounter,
        }),
  });
}
