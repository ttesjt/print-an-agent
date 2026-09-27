import { createProviderAgentAPI } from '@ta-agent/base-composition';
import type { AgentIdentity } from '@ta-agent/base-identity';
import { createStandaloneCredentialResolver } from '../credential-resolver.js';
import {
  resolveStandaloneRequestPolicy,
  resolveStandaloneSessionCompactionPolicy,
} from '../runtime-policies.js';
import type {
  StandaloneAgent,
  StandaloneAgentDefinition,
  StandaloneRuntimeOptions,
} from '../types.js';
import type { ManagedAgentRuntimePorts } from './contracts.js';

export function createManagedStandaloneAgent(
  identity: AgentIdentity,
  definition: StandaloneAgentDefinition,
  ports: ManagedAgentRuntimePorts,
  options: StandaloneRuntimeOptions
): StandaloneAgent {
  const credentialResolver =
    definition.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(definition.credential, options);

  return createProviderAgentAPI({
    identity,
    provider: {
      config: definition.provider.config,
      transportLivenessPolicy: definition.provider.transportLivenessPolicy,
      ...(credentialResolver === undefined ? {} : { credentialResolver }),
    },
    session: ports.session,
    requestJournal: ports.requestJournal,
    ...(options.stepOverrides === undefined ? {} : { stepOverrides: options.stepOverrides }),
    requestPolicy: resolveStandaloneRequestPolicy(definition.request, options.requestLimits),
    sessionCompactionPolicy: resolveStandaloneSessionCompactionPolicy(definition.sessionCompaction),
    mainActor: definition.mainActor,
  });
}
