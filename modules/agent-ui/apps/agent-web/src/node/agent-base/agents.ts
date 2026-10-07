import { parseAgentId } from '@ta-agent/base-identity';
import { AgentConfigError } from '@ta-agent/base-config';
import type { AgentManagementPort } from '../../application/ports.js';
import type { AgentWebConfig } from '../../application/agent-config.js';
import type { AgentManagementResult } from '@ta-agent/ui-contracts';
import { defineAgentWebConfig } from '../../application/agent-config-validation.js';
import {
  validateWebModelConfig,
  testWebModelConnection,
  createWebModelRuntime,
} from './model-runtime.js';
import { agentFailure } from './failures.js';
import { projectAgent, revision } from './projection.js';
import type { WebBackendServices } from './profile.js';

export function createWebAgentManagement(
  services: WebBackendServices
): AgentManagementPort<AgentWebConfig> {
  const query = async <Value>(
    signal: AbortSignal | undefined,
    action: () => Promise<Value>,
    readRevision?: () => Promise<string>
  ): Promise<AgentManagementResult<Value>> => {
    signal?.throwIfAborted();
    try {
      const value = await action();
      signal?.throwIfAborted();
      return { status: 'succeeded', value };
    } catch (error) {
      signal?.throwIfAborted();
      return { status: 'failed', failure: await agentFailure(error, readRevision) };
    }
  };
  const inspect = async (id: string) =>
    projectAgent(await services.agents.inspect(parseAgentId(id)));
  const config = (input: unknown) => {
    const value = defineAgentWebConfig(input);
    validateWebModelConfig(value, services.modelHost);
    return value;
  };
  return {
    renameAgent: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.rename({
              agentId: parseAgentId(input.agentId),
              displayName: input.displayName,
              expectedIdentityRevision: revision(input.expectedRevision),
            })
          ).details,
        async () => (await inspect(input.agentId)).details.identityRevision
      ),
    inspectModel: (input) =>
      query(input.signal, async () => {
        const snapshot = await inspect(input.agentId);
        const binding = snapshot.config.value.model;
        if (binding.kind === 'unconfigured')
          return {
            revision: snapshot.config.revision,
            status: 'unconfigured' as const,
            label: 'Model not configured',
          };
        const { provider } = createWebModelRuntime(snapshot.config.value, services.modelHost);
        const status =
          provider === undefined
            ? ('engine' as const)
            : (
                  await provider.checkReadiness(
                    input.signal === undefined ? {} : { signal: input.signal }
                  )
                ).status === 'ready'
              ? ('configured' as const)
              : ('credential-unavailable' as const);
        return {
          revision: snapshot.config.revision,
          status,
          label:
            binding.kind === 'engine'
              ? `Host Engine: ${binding.engineId}`
              : `${binding.config.reference.provider} / ${binding.config.reference.model}`,
        };
      }),
    testModelConnection: (input) =>
      query(
        input.signal,
        async () => {
          const snapshot = await inspect(input.agentId);
          if (snapshot.config.revision !== input.expectedRevision)
            throw new AgentConfigError('CONFIG_REVISION_CONFLICT', 'Config changed.');
          await testWebModelConnection(
            snapshot.config.value,
            services.modelHost,
            input.signal ?? new AbortController().signal
          );
          const current = await inspect(input.agentId);
          if (current.config.revision !== snapshot.config.revision)
            throw new AgentConfigError('CONFIG_REVISION_CONFLICT', 'Config changed.');
          return { revision: snapshot.config.revision, checkedAt: new Date().toISOString() };
        },
        async () => (await inspect(input.agentId)).config.revision
      ),
    listAgents: (input = {}) =>
      query(input.signal, async () =>
        (await services.agents.list()).map((snapshot) => {
          const details = projectAgent(snapshot).details;
          return {
            agentId: details.agentId,
            displayName: details.displayName,
            identityRevision: details.identityRevision,
            status: details.status,
            updatedAt: details.updatedAt,
          };
        })
      ),
    inspectAgent: (input) => query(input.signal, () => inspect(input.agentId)),
    readAgentConfig: (input) =>
      query(input.signal, async () => (await inspect(input.agentId)).config),
    createAgent: (input) =>
      query(input.signal, async () =>
        projectAgent(
          await services.agents.create({
            identity: { id: input.identity.agentId, displayName: input.identity.displayName },
            config: config(input.config),
          })
        )
      ),
    updateAgentConfig: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.updateConfig({
              agentId: parseAgentId(input.agentId),
              config: config(input.config),
              expectedRevision: revision(input.expectedRevision),
            })
          ).config,
        async () => (await inspect(input.agentId)).config.revision
      ),
    disableAgent: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.disable({
              agentId: parseAgentId(input.agentId),
              expectedIdentityRevision: revision(input.expectedRevision),
            })
          ).details,
        async () => (await inspect(input.agentId)).details.identityRevision
      ),
    reactivateAgent: (input) =>
      query(
        input.signal,
        async () =>
          projectAgent(
            await services.agents.reactivate({
              agentId: parseAgentId(input.agentId),
              expectedIdentityRevision: revision(input.expectedRevision),
            })
          ).details,
        async () => (await inspect(input.agentId)).details.identityRevision
      ),
  };
}
