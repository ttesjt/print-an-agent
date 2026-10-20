import {
  composeAgent,
  defineManagedAgentComposition,
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  type ManagedAgentAuthorityPortFactory,
  type ManagedAgentNamespacePort,
  type ManagedAgentNamespace,
  type ManagedAgentRuntimeMaterializationInput,
  type ManagedAgentRuntimeProvisioningInput,
  AgentManagementError,
} from '@ta-agent/base-composition';
import {
  createActorCatalog,
  createResponsibilityCatalog,
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
} from '@ta-agent/base-actor';
import { type ActorEngine } from '@ta-agent/model-invocation-core';
import {
  createMemorySessionPersistence,
  createSqliteSessionPersistence,
  type CoordinatedSessionPersistence,
} from '@ta-agent/base-local-adapters';
import {
  createStandaloneMemoryDefinition,
  createStandaloneDirectoryDefinition,
} from '@ta-agent/base-standalone-agent';
import type { AgentId } from '@ta-agent/base-identity';
import type { ToolRegistry } from '@ta-agent/base-tool';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { WEB_AGENT_CONFIG_CODEC } from './config.js';
import { presentationStepOverrides } from './stream-sink.js';
import { createWebModelRuntime, actorInvocation, webActorInstructions } from './model-runtime.js';
import { DEFAULT_REQUEST_POLICY } from '@ta-agent/base-request';
import { validatePresentationWait } from './presentation-wait.js';

export interface WebBackendOptions {
  /** Bounded post-commit UI projection only; model execution deadlines are configured separately. */
  readonly presentationWaitMilliseconds?: number;
  readonly engine?: ActorEngine;
  readonly readEnvironmentVariable?: (name: string) => string | undefined;
  readonly persistence:
    | Readonly<{ kind: 'memory' }>
    | Readonly<{ kind: 'directory'; rootDirectory: string }>;
  readonly tools?: ToolRegistry;
  readonly toolLabels?: Readonly<Record<string, string>>;
}

export function createWebBackendServices(options: WebBackendOptions) {
  if (options.presentationWaitMilliseconds !== undefined)
    validatePresentationWait(options.presentationWaitMilliseconds);
  if (options.persistence.kind === 'directory') {
    const profile = createStandaloneDirectoryDefinition({
      rootDirectory: options.persistence.rootDirectory,
      readEnvironmentVariable: () => undefined,
    });
    return assembleServices(
      profile.namespace.port,
      profile.authority.createPorts,
      (namespace) =>
        createSqliteSessionPersistence({ databasePath: namespace.handle.databasePath }),
      options
    );
  }
  const profile = createStandaloneMemoryDefinition({ readEnvironmentVariable: () => undefined });
  const persistence = new Map<AgentId, CoordinatedSessionPersistence>();
  return assembleServices(
    profile.namespace.port,
    profile.authority.createPorts,
    (namespace) => {
      let scoped = persistence.get(namespace.agentId);
      if (scoped === undefined) {
        scoped = createMemorySessionPersistence();
        persistence.set(namespace.agentId, scoped);
      }
      return scoped;
    },
    options
  );
}

function assembleServices<Handle>(
  namespace: ManagedAgentNamespacePort<Handle>,
  authority: ManagedAgentAuthorityPortFactory<Handle>,
  persistence: (namespace: ManagedAgentNamespace<Handle>) => CoordinatedSessionPersistence,
  options: WebBackendOptions
) {
  const toolNames = options.tools?.list().map((tool) => tool.name) ?? [];
  const materialize = ({
    identity,
    config,
    ports,
  }: ManagedAgentRuntimeMaterializationInput<AgentWebConfig, CoordinatedSessionPersistence>) => {
    const { engine } = createWebModelRuntime(config, options);
    return composeAgent({
      identity,
      actorCatalog: createActorCatalog({
        engines: [engine],
        actors: [
          {
            id: MAIN_ACTOR_ID,
            engineId: engine.id,
            instructions: webActorInstructions(config),
            invocationConfig: actorInvocation(config),
            invocationPolicy: { timeoutMilliseconds: config.execution.actorTimeoutMilliseconds },
            allowedTools: toolNames,
          },
        ],
      }),
      responsibilityCatalog: createResponsibilityCatalog({
        responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) => ({
          ...definition,
          allowedTools: definition.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID ? toolNames : [],
        })),
      }),
      session: ports.session,
      requestJournal: ports.requestJournal,
      stepOverrides: presentationStepOverrides(),
      requestPolicy: {
        ...DEFAULT_REQUEST_POLICY,
        timeoutMilliseconds: config.execution.requestTimeoutMilliseconds,
      },
      ...(options.tools === undefined
        ? {}
        : {
            toolRegistry: options.tools,
            productToolAllowList: toolNames,
            runtimeToolAllowList: toolNames,
          }),
    });
  };
  const definition = defineManagedAgentComposition({
    config: { codec: WEB_AGENT_CONFIG_CODEC },
    namespace: { port: namespace },
    authority: { createPorts: authority },
    runtime: {
      createPorts: ({
        namespace: scoped,
      }: ManagedAgentRuntimeProvisioningInput<AgentWebConfig, Handle>) => persistence(scoped),
      materialize,
    },
    sessionManagement: {
      createPorts: (scoped: ManagedAgentNamespace<Handle>) => persistence(scoped),
    },
    sessionNavigation: {
      createPorts: (scoped: ManagedAgentNamespace<Handle>) => ({
        session: persistence(scoped).session,
      }),
    },
  });
  const sessionFor = async (agentId: AgentId) => {
    const scoped = await namespace.resolve(agentId);
    if (scoped === undefined)
      throw new AgentManagementError(
        'MANAGED_AGENT_NOT_FOUND',
        'inspect',
        'Agent namespace does not exist.'
      );
    return persistence(scoped).session;
  };
  return Object.freeze({
    agents: createAgentManagementService(definition),
    runtime: createAgentRuntimeService(definition),
    sessions: createSessionManagementService(definition),
    navigation: createSessionNavigationService(definition),
    sessionFor,
    toolLabels: options.toolLabels ?? {},
    modelHost: options,
  });
}

export type WebBackendServices = ReturnType<typeof createWebBackendServices>;
