import type {
  CollectionConnection,
  WorkspaceExtension,
  WorkspaceExtensionProps,
  WorkspaceEditBoundary,
} from '@print-an-agent/ui-workspace';
import { useWorkspaceBoundary } from '@print-an-agent/ui-workspace';
import { AgentCreateDialog, Alert, Cluster } from '@print-an-agent/ui-react';
import { useMemo } from 'react';
import { createDefaultWorkspacePorts } from './default-ports.js';
import type { AgentWebPorts } from './ports.js';
import type { AgentWebConfig } from './agent-config.js';
import { useDefaultConfiguration } from '../agent/use-default-configuration.js';
import { useModelManagement } from '../agent/use-model-management.js';
import { AgentProfile } from '../components/agent-profile.js';
import { AgentConfigurationFields } from '../components/agent-workspace.js';
import { TemporaryConversationFeature } from '../temporary-conversation/feature.js';
import { MemoryManagement } from '../memory/ui/management.js';
import type { ReactNode } from 'react';

export function createDefaultConnection(
  ports: AgentWebPorts<AgentWebConfig>,
  profileLabel = 'Agent application',
  creationConfig?: AgentWebConfig
): CollectionConnection {
  const workspace = createDefaultWorkspacePorts(ports);
  const Extension: WorkspaceExtension = (props) => (
    <MemoryManagement ports={ports.memory} agentId={props.agent?.agentId}>
      {(memory) => (
        <DefaultExtension
          {...props}
          ports={ports}
          memory={memory}
          {...(creationConfig === undefined ? {} : { creationConfig })}
        />
      )}
    </MemoryManagement>
  );
  return { ports: workspace, profileLabel, extension: Extension };
}
function DefaultExtension({
  agent,
  refresh,
  onCreated,
  children,
  ports,
  creationConfig,
  memory,
}: WorkspaceExtensionProps & {
  readonly ports: AgentWebPorts<AgentWebConfig>;
  readonly creationConfig?: AgentWebConfig;
  readonly memory: {
    readonly action?: ReactNode;
    readonly panel?: ReactNode;
    readonly boundary?: WorkspaceEditBoundary;
  };
}) {
  const agents = useDefaultConfiguration(ports.agents, agent, refresh, onCreated, creationConfig);
  const model = useModelManagement(ports.agents, agents.selectionState);
  const dirty = (agents.configDirty && !agents.configWorking) || agents.createOpen;
  const configEdit = agents.configDirty ? agents.configDraft : undefined;
  const createIdentity = agents.createOpen ? agents.createIdentity : undefined;
  const createConfig = agents.createOpen ? agents.createConfig : undefined;
  const editIdentity = useMemo(
    () => (dirty ? {} : undefined),
    [dirty, configEdit, createIdentity, createConfig]
  );
  const boundary = useWorkspaceBoundary([
    {
      dirty,
      navigationBlocked: agents.createPending || model.testing,
      working: agents.configWorking || agents.createPending || model.testing,
      editIdentity,
      discard: () => {
        agents.resetConfig();
        agents.setCreateOpen(false);
      },
    },
    memory.boundary,
  ]);
  return children({
    headerActions: (
      <Cluster>
        {memory.action}
        {ports.temporaryConversations === undefined ? undefined : (
          <TemporaryConversationFeature
            port={ports.temporaryConversations}
            agents={ports.agents}
            agent={agent}
            allowed={model.ready}
          />
        )}
      </Cluster>
    ),
    settings: <AgentProfile agents={agents} model={model} />,
    requestCreate: () => agents.setCreateOpen(true),
    boundary,
    interaction: {
      allowed: model.ready,
      notice: model.ready ? undefined : (
        <Alert tone="caution">
          {model.state.status === 'loading'
            ? 'Checking model availability…'
            : model.state.status === 'failed'
              ? model.state.error
              : 'Configure an available model to start a response.'}
        </Alert>
      ),
    },
    createDialog: (
      <>
        {memory.panel}
        <AgentCreateDialog
          cancelLabel="Cancel"
          configFields={
            <AgentConfigurationFields
              config={agents.createConfig}
              fieldErrors={agents.createConfigErrors}
              onChange={agents.setCreateConfig}
              prefix="create"
            />
          }
          description="Create an immutable Agent identity and configure its own model connection."
          error={agents.createError}
          fieldErrors={agents.createIdentityErrors}
          identity={agents.createIdentity}
          labels={{ agentId: 'Agent ID', displayName: 'Display name' }}
          onIdentityChange={agents.setCreateIdentity}
          onOpenChange={agents.setCreateOpen}
          onSubmit={() => void agents.createAgent()}
          open={agents.createOpen}
          pending={agents.createPending}
          submitLabel="Create Agent"
          title="Create Agent"
        />
      </>
    ),
  });
}
