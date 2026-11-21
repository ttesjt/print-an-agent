import {
  CONTEXT_MEMORY_TOOL_NAMES,
  recoverSessionWithContextMemory,
  type ManagedAgentNamespace,
  type RuntimeMemorySessionPort,
  type SessionContextMemoryCoordinator,
  type SessionContextMemoryService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneSessionDefinition as BaseDefinition } from '../../setup/index.js';
import type { MemoryAllocationResolver } from '../types/allocation.js';
import type { StandaloneMemoryManagementOptions } from '../types/options.js';
import type { RuntimeMemoryLifetime } from './lifetime.js';
import { runtimeMemoryProvisioning, runtimeMemorySession } from './provisioning.js';
import type { RuntimeMemoryIntegration } from './types.js';

export function createRuntimeMemoryIntegration<N>(
  source: BaseDefinition<N>,
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>,
  runtimeLifetime: RuntimeMemoryLifetime,
  assertOpen: () => void
): RuntimeMemoryIntegration<N> {
  const runtimeEnabled = (agentId: string): boolean =>
    options.context?.runtime !== undefined && (options.context.runtime.enabled?.(agentId) ?? true);
  const runtimeMemory = runtimeMemoryProvisioning(options, allocation, runtimeLifetime);
  const coordinator = (service: SessionContextMemoryService): SessionContextMemoryCoordinator => ({
    authorityId: service.authorityId,
    open: (target, signal) => runtimeLifetime.track(service).open(target, signal),
    inspect: service.inspect.bind(service),
    apply: service.apply.bind(service),
    initialize: service.initialize.bind(service),
    recover: service.recover.bind(service),
    readCheckpoint: service.readCheckpoint.bind(service),
    acknowledgeCleanup: service.acknowledgeCleanup.bind(service),
    navigationPort: service.navigationPort.bind(service),
  });
  const memoryNamespace = async (agentId: string): Promise<ManagedAgentNamespace<N>> => {
    if (!runtimeEnabled(agentId))
      throw new AgentBaseStandaloneError('Runtime Context Memory is disabled for this Agent.');
    const namespace = await source.namespace.port.resolve(parseAgentId(agentId));
    assertOpen();
    if (namespace === undefined) throw new AgentBaseStandaloneError('Agent was not found.');
    return namespace;
  };
  const runtime: BaseDefinition<N>['runtime'] = {
    createPorts: async (request) => {
      const ports = await source.runtime.createPorts(request);
      return !runtimeEnabled(request.namespace.agentId)
        ? ports
        : {
            ...ports,
            contextMemory: runtimeLifetime.track(
              await runtimeMemory(request.namespace, ports.session)
            ),
            contextMemoryToolAllowList:
              options.context?.runtime?.toolAllowList ??
              (options.context?.runtime?.writable === true
                ? CONTEXT_MEMORY_TOOL_NAMES
                : ['read_context_memory']),
          };
    },
    materialize: (request) => source.runtime.materialize(request),
  };
  const sessionNavigation: BaseDefinition<N>['sessionNavigation'] = {
    createPorts: async (namespace) => {
      const ports = await source.sessionNavigation.createPorts(namespace);
      if (!runtimeEnabled(namespace.agentId)) return ports;
      runtimeMemorySession(ports.session);
      const service = await runtimeMemory(namespace, ports.session);
      return { session: service.navigationPort(ports.session) };
    },
  };
  const sessionManagement: BaseDefinition<N>['sessionManagement'] = {
    createPorts: async (namespace) => {
      const ports = await source.sessionManagement.createPorts(namespace);
      if (!runtimeEnabled(namespace.agentId)) return ports;
      return {
        ...ports,
        maintenance: {
          purgeSessionPersistence: (request) => ports.maintenance.purgeSessionPersistence(request),
          recoverSessionPersistence: (request, call) => {
            runtimeMemorySession(ports.session);
            return recoverSessionWithContextMemory(
              {
                session: ports.session,
                maintenance: ports.maintenance,
                resolveMemory: () => runtimeMemory(namespace, ports.session),
              },
              request,
              call
            );
          },
        },
      };
    },
  };

  return {
    runtime,
    sessionNavigation,
    sessionManagement,
    ...(options.context?.runtime === undefined
      ? {}
      : {
          sessionContextMemory: {
            resolve: async (agentId: string) => {
              const namespace = await memoryNamespace(agentId);
              const ports = await source.sessionNavigation.createPorts(namespace);
              return coordinator(await runtimeMemory(namespace, ports.session));
            },
            bind: async (agentId: string, session: RuntimeMemorySessionPort) =>
              coordinator(await runtimeMemory(await memoryNamespace(agentId), session)),
          },
        }),
  };
}
