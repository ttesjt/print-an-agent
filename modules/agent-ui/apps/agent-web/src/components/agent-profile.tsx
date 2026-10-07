import {
  Alert,
  Button,
  Cluster,
  FormField,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  TextInput,
} from '@ta-agent/ui-react';
import type { AgentManagementController } from '../agent/use-agent-management.js';
import type { AgentMetadataController } from '../agent/use-agent-metadata.js';
import type { ModelManagementController } from '../agent/use-model-management.js';
import { AgentWorkspace } from './agent-workspace.js';
import { ModelConnectionStatus } from './model-connection-status.js';
import { AgentLifecyclePanel } from './agent-lifecycle-panel.js';

export function AgentProfile({
  agents,
  metadata,
  model,
}: Readonly<{
  agents: AgentManagementController;
  metadata: AgentMetadataController;
  model: ModelManagementController;
}>) {
  return (
    <Stack space="large">
      <h1>Agent Profile</h1>
      {agents.selected !== undefined && (
        <Panel>
          <PanelHeader>
            <h2>Display name</h2>
            <p>Agent ID is permanent. Display name can change.</p>
          </PanelHeader>
          <PanelBody>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void metadata.save();
              }}
            >
              <Stack space="small">
                <FormField
                  controlId="profile-display-name"
                  label="Display name"
                  error={metadata.error}
                  required
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      value={metadata.displayName}
                      disabled={metadata.pending}
                      onChange={(event) => metadata.setDisplayName(event.currentTarget.value)}
                    />
                  )}
                </FormField>
                <Cluster space="small">
                  <Button
                    type="submit"
                    pending={metadata.pending}
                    disabled={!metadata.dirty || metadata.conflict}
                  >
                    Save display name
                  </Button>
                  <Button appearance="outline" disabled={metadata.pending} onClick={metadata.reset}>
                    Discard name changes
                  </Button>
                </Cluster>
                {metadata.conflict && (
                  <Alert tone="caution">
                    <Button onClick={() => void agents.reloadLifecycle()}>
                      Reload current identity
                    </Button>
                  </Alert>
                )}
              </Stack>
            </form>
          </PanelBody>
        </Panel>
      )}
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
      <AgentLifecyclePanel agents={agents} />
    </Stack>
  );
}
