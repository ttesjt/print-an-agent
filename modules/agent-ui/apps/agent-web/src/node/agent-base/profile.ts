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
  type SessionContextMemoryCoordinator,
  CONTEXT_MEMORY_TOOL_NAMES,
  recoverSessionWithContextMemory,
} from '@print-an-agent/base-composition';
import {
  createActorCatalog,
  createResponsibilityCatalog,
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
} from '@print-an-agent/base-actor';
import { type ActorEngine } from '@print-an-agent/model-invocation-core';
import {
  createMemorySessionPersistence,
  createSqliteSessionPersistence,
  type CoordinatedSessionPersistence,
} from '@print-an-agent/base-local-adapters';
import {
  createStandaloneMemorySetup,
  createStandaloneDirectorySetup,
  type StandaloneSessionContextMemory,
} from '@print-an-agent/base-standalone-agent';
import {
  supportsSessionMemoryNavigation,
  supportsSessionExecution,
} from '@print-an-agent/base-session';
import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { ToolRegistry } from '@print-an-agent/base-tool';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { WEB_AGENT_CONFIG_CODEC } from './config.js';
import { presentationStepOverrides } from './stream-sink.js';
import { createWebModelRuntime, actorInvocation, webActorInstructions } from './model-runtime.js';
import { DEFAULT_REQUEST_POLICY } from '@print-an-agent/base-request';
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
        profile,
        setup.sessionContextMemory
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
      profile,
      setup.sessionContextMemory
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
  >,
  runtimeMemory?: StandaloneSessionContextMemory
) {
  const toolNames = options.tools?.list().map((tool) => tool.name) ?? [];
  type RuntimePorts = CoordinatedSessionPersistence & {
    readonly contextMemory?: SessionContextMemoryCoordinator;
    readonly memoryToolNames?: readonly string[];
  };
  const enabled = (agentId: string) =>
    options.memory?.provisioning.context?.runtime !== undefined &&
    (options.memory.provisioning.context.runtime.enabled?.(agentId) ?? true);
  const attachMemory = async (
    scoped: ManagedAgentNamespace<Handle>,
    ports: CoordinatedSessionPersistence
  ): Promise<RuntimePorts> => {
    if (!enabled(scoped.agentId)) return ports;
    if (
      runtimeMemory === undefined ||
      !supportsSessionMemoryNavigation(ports.session) ||
      !supportsSessionExecution(ports.session)
    )
      throw new Error('Runtime Context Memory requires explicit history and Session provisioning.');
    const policy = options.memory?.provisioning.context?.runtime;
    return {
      ...ports,
      contextMemory: await runtimeMemory.bind(scoped.agentId, ports.session),
      memoryToolNames:
        policy?.toolAllowList ??
        (policy?.writable === true ? CONTEXT_MEMORY_TOOL_NAMES : ['read_context_memory']),
    };
  };
  const materialize = ({
    identity,
    config,
    ports,
  }: ManagedAgentRuntimeMaterializationInput<AgentWebConfig, RuntimePorts>) => {
    const { engine } = createWebModelRuntime(config, options);
    const allowedTools = [...toolNames, ...(ports.memoryToolNames ?? [])];
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
            allowedTools,
          },
        ],
      }),
      responsibilityCatalog: createResponsibilityCatalog({
        responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) => ({
          ...definition,
          allowedTools:
            definition.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID ? allowedTools : [],
        })),
      }),
      session: ports.session,
      requestJournal: ports.requestJournal,
      ...(ports.contextMemory === undefined ? {} : { contextMemory: ports.contextMemory }),
      stepOverrides: presentationStepOverrides(),
      requestPolicy: {
        ...DEFAULT_REQUEST_POLICY,
        timeoutMilliseconds: config.execution.requestTimeoutMilliseconds,
      },
      ...(options.tools === undefined && ports.contextMemory === undefined
        ? {}
        : {
            ...(options.tools === undefined ? {} : { toolRegistry: options.tools }),
            productToolAllowList: allowedTools,
            runtimeToolAllowList: allowedTools,
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
      }: ManagedAgentRuntimeProvisioningInput<AgentWebConfig, Handle>) =>
        attachMemory(scoped, persistence(scoped)),
      materialize,
    },
    sessionManagement: {
      createPorts: (scoped: ManagedAgentNamespace<Handle>) => {
        const ports = persistence(scoped);
        if (!enabled(scoped.agentId)) return ports;
        return {
          ...ports,
          maintenance: {
            purgeSessionPersistence: ports.maintenance.purgeSessionPersistence.bind(
              ports.maintenance
            ),
            recoverSessionPersistence: async (
              request: import('@print-an-agent/base-session').RecoverSessionExecutionsInput,
              call?: import('@print-an-agent/base-composition').ManagementOperationOptions
            ) => {
              if (!supportsSessionMemoryNavigation(ports.session))
                throw new Error('Session Memory recovery is not installed.');
              return recoverSessionWithContextMemory(
                {
                  session: ports.session,
                  maintenance: ports.maintenance,
                  resolveMemory: async () => {
                    const bound = await attachMemory(scoped, ports);
                    if (bound.contextMemory === undefined)
                      throw new Error('Session Memory recovery is disabled.');
                    return bound.contextMemory;
                  },
                },
                request,
                call
              );
            },
          },
        };
      },
    },
    sessionNavigation: {
      createPorts: async (scoped: ManagedAgentNamespace<Handle>) => {
        const ports = await attachMemory(scoped, persistence(scoped));
        if (ports.contextMemory === undefined) return { session: ports.session };
        if (
          !supportsSessionMemoryNavigation(ports.session) ||
          !supportsSessionExecution(ports.session)
        )
          throw new Error('Session Memory navigation is not installed.');
        return { session: ports.contextMemory.navigationPort(ports.session) };
      },
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
