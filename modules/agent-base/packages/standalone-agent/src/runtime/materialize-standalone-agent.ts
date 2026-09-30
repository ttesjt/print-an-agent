import { createProviderAgentAPI } from '@ta-agent/base-composition';
import type { AgentIdentity } from '@ta-agent/base-identity';
import type { RequestJournalPort } from '@ta-agent/base-request';
import type { NavigableCompactableSessionPort } from '@ta-agent/base-session';
import { createStandaloneCredentialResolver } from '../credential-resolver.js';
import {
  resolveStandaloneRequestPolicy,
  resolveStandaloneSessionCompactionPolicy,
} from '../runtime-policies.js';
import type { StandaloneAgent, StandaloneAgentConfig, StandaloneRuntimeOptions } from '../types.js';

export interface StandaloneRuntimePorts {
  readonly session: NavigableCompactableSessionPort;
  readonly requestJournal: RequestJournalPort;
}

export interface StandaloneRuntimeMaterializationInput {
  readonly identity: AgentIdentity;
  readonly config: StandaloneAgentConfig;
  readonly ports?: StandaloneRuntimePorts;
  readonly options: StandaloneRuntimeOptions;
}

/** The single Standard provider runtime assembly path used by direct and managed profiles. */
export function materializeStandaloneAgentRuntime(
  input: StandaloneRuntimeMaterializationInput
): StandaloneAgent {
  const credentialResolver =
    input.config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(input.config.credential, input.options);

  return createProviderAgentAPI({
    identity: input.identity,
    provider: {
      config: input.config.provider.config,
      transportLivenessPolicy: input.config.provider.transportLivenessPolicy,
      ...(credentialResolver === undefined ? {} : { credentialResolver }),
    },
    ...(input.ports === undefined
      ? {}
      : { session: input.ports.session, requestJournal: input.ports.requestJournal }),
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
    mainActor: input.config.mainActor,
  });
}
