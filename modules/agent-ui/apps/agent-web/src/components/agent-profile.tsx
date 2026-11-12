import { Stack } from '@print-an-agent/ui-react';
import type { DefaultConfigurationController } from '../agent/use-default-configuration.js';
import type { ModelManagementController } from '../agent/use-model-management.js';
import { AgentWorkspace } from './agent-workspace.js';
import { ModelConnectionStatus } from './model-connection-status.js';
export function AgentProfile({
  agents,
  model,
}: Readonly<{ agents: DefaultConfigurationController; model: ModelManagementController }>) {
  return (
    <Stack space="large">
      <AgentWorkspace
        configConflict={agents.configConflict}
        configDirty={agents.configDirty}
        configDraft={agents.configDraft}
        configError={agents.configError}
        configFieldErrors={agents.configFieldErrors}
        onReloadConfig={() => void agents.reloadConfig()}
        onResetConfig={agents.resetConfig}
        onSaveConfig={() => void agents.saveConfig()}
        selectionState={agents.selectionState}
        setConfigDraft={agents.setConfigDraft}
        working={agents.configWorking}
      />
      <ModelConnectionStatus controller={model} dirty={agents.configDirty} />
    </Stack>
  );
}
