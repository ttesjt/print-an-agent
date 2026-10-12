import type {
  CollectionConnection,
  WorkspaceExtension,
  WorkspaceExtensionProps,
} from '@ta-agent/ui-workspace';
import { AgentCreateDialog, Alert } from '@ta-agent/ui-react';
import { useMemo } from 'react';
import { createDefaultWorkspacePorts } from './default-ports.js';
import type { AgentWebPorts } from './ports.js';
import type { AgentWebConfig } from './agent-config.js';
import { useDefaultConfiguration } from '../agent/use-default-configuration.js';
import { useModelManagement } from '../agent/use-model-management.js';
import { AgentProfile } from '../components/agent-profile.js';
import { AgentConfigurationFields } from '../components/agent-workspace.js';

export function createDefaultConnection(
  ports: AgentWebPorts<AgentWebConfig>,
  profileLabel = 'Agent application',
  creationConfig?: AgentWebConfig
): CollectionConnection {
  const workspace = createDefaultWorkspacePorts(ports);
  const Extension: WorkspaceExtension = (props) => (
    <DefaultExtension
      {...props}
      ports={ports}
      {...(creationConfig === undefined ? {} : { creationConfig })}
    />
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
}: WorkspaceExtensionProps & {
  readonly ports: AgentWebPorts<AgentWebConfig>;
  readonly creationConfig?: AgentWebConfig;
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
  return children({
    settings: <AgentProfile agents={agents} model={model} />,
    requestCreate: () => agents.setCreateOpen(true),
    boundary: {
      dirty,
      navigationBlocked: agents.createPending || model.testing,
      working: agents.configWorking || agents.createPending || model.testing,
      editIdentity,
      discard: () => {
        agents.resetConfig();
        agents.setCreateOpen(false);
      },
    },
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
    ),
  });
}
