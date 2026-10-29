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
  type ContextMemoryManagementCapability,
  type RetrievalMemoryManagementCapability,
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
  createStandaloneMemorySetup,
  createStandaloneDirectorySetup,
} from '@ta-agent/base-standalone-agent';
import type { AgentId } from '@ta-agent/base-identity';
import type { ToolRegistry } from '@ta-agent/base-tool';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { WEB_AGENT_CONFIG_CODEC } from './config.js';
import { presentationStepOverrides } from './stream-sink.js';
import { createWebModelRuntime, actorInvocation, webActorInstructions } from './model-runtime.js';
import { DEFAULT_REQUEST_POLICY } from '@ta-agent/base-request';
import { validatePresentationWait } from './presentation-wait.js';
import { createWebMemoryPorts } from '../memory/ports.js';
import type { WebMemoryOptions } from '../memory/options.js';

export interface WebBackendOptions {
  readonly memory?: WebMemoryOptions;
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
    const setup = createStandaloneDirectorySetup(
      {
        rootDirectory: options.persistence.rootDirectory,
        readEnvironmentVariable: () => undefined,
      },
      options.memory?.provisioning
    );
    const profile = setup.definition;
    return Object.freeze({
      ...assembleServices(
        profile.namespace.port,
        profile.authority.createPorts,
        (namespace) =>
          createSqliteSessionPersistence({ databasePath: namespace.handle.databasePath }),
        options,
        profile
      ),
      close: () => setup.close(),
    });
  }
  const setup = createStandaloneMemorySetup(
    { readEnvironmentVariable: () => undefined },
    options.memory?.provisioning
  );
  const profile = setup.definition;
  const persistence = new Map<AgentId, CoordinatedSessionPersistence>();
  return Object.freeze({
    ...assembleServices(
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
      options,
      profile
    ),
    close: async () => {
      await setup.close();
      persistence.clear();
    },
  });
}

function assembleServices<Handle>(
  namespace: ManagedAgentNamespacePort<Handle>,
  authority: ManagedAgentAuthorityPortFactory<Handle>,
  persistence: (namespace: ManagedAgentNamespace<Handle>) => CoordinatedSessionPersistence,
  options: WebBackendOptions,
  memory: Partial<
    ContextMemoryManagementCapability<Handle> & RetrievalMemoryManagementCapability<Handle>
  >
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
    ...(memory.contextMemoryManagement === undefined
      ? {}
      : { contextMemoryManagement: memory.contextMemoryManagement }),
    ...(memory.retrievalMemoryManagement === undefined
      ? {}
      : { retrievalMemoryManagement: memory.retrievalMemoryManagement }),
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
    memory: createWebMemoryPorts(definition, options.memory),
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
