import {
  AgentLifecycleActions,
  Alert,
  Button,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
} from '@ta-agent/ui-react';
import type { AgentManagementController } from '../agent/use-agent-management.js';

export function AgentLifecyclePanel({ agents }: Readonly<{ agents: AgentManagementController }>) {
  return (
    <Panel>
      <PanelHeader>
        <h2>Agent lifecycle</h2>
      </PanelHeader>
      <PanelBody>
        <Stack space="small">
          {agents.selected === undefined ? (
            <p>Select an Agent to inspect its lifecycle.</p>
          ) : (
            <AgentLifecycleActions
              disableLabel="Disable Agent"
              onReactivate={() => void agents.changeLifecycle('active')}
              onRequestDisable={() => agents.setDisableOpen(true)}
              pending={agents.lifecycleWorking}
              reactivateLabel="Reactivate Agent"
              status={agents.selected.details.status}
            />
          )}
          {agents.lifecycleConflict !== undefined && (
            <Alert announcement="assertive" tone="caution">
              <span>{agents.lifecycleConflict}</span>
              <Button
                appearance="outline"
                onClick={() => void agents.reloadLifecycle()}
                pending={agents.lifecycleWorking}
              >
                Reload current lifecycle
              </Button>
            </Alert>
          )}
          {agents.lifecycleError !== undefined && (
            <Alert announcement="assertive" tone="critical">
              {agents.lifecycleError}
            </Alert>
          )}
        </Stack>
      </PanelBody>
    </Panel>
  );
}
