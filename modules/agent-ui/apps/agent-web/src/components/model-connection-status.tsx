import {
  Alert,
  Button,
  Cluster,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  Status,
} from '@print-an-agent/ui-react';
import type { ModelManagementController } from '../agent/use-model-management.js';

export function ModelConnectionStatus({
  controller,
  dirty,
}: Readonly<{ controller: ModelManagementController; dirty: boolean }>) {
  const state = controller.state;
  return (
    <Panel>
      <PanelHeader>
        <h2>Model availability</h2>
      </PanelHeader>
      <PanelBody>
        <Stack space="small">
          {state.status === 'loading' && (
            <Status>Checking saved configuration and server credential…</Status>
          )}
          {state.status === 'failed' && <Alert tone="critical">{state.error}</Alert>}
          {state.status === 'ready' && (
            <>
              <strong>{state.value.label}</strong>
              <p>
                {state.value.status === 'unconfigured'
                  ? 'Configure and save a model to enable conversation.'
                  : state.value.status === 'credential-unavailable'
                    ? 'The referenced environment credential is unavailable on the server.'
                    : state.value.status === 'engine'
                      ? 'Explicit demonstration Engine. This is not a real provider.'
                      : 'Configuration and credential are available. Network connectivity has not been tested.'}
              </p>
            </>
          )}
          <Cluster space="small">
            <Button appearance="outline" onClick={controller.refresh} disabled={controller.testing}>
              Refresh availability
            </Button>
            <Button
              onClick={() => void controller.testConnection()}
              disabled={
                dirty ||
                !controller.ready ||
                (state.status === 'ready' && state.value.status === 'engine')
              }
              pending={controller.testing}
            >
              Test saved connection
            </Button>
            {controller.testing && (
              <Button appearance="outline" onClick={controller.cancelTest}>
                Cancel test
              </Button>
            )}
          </Cluster>
          <p>
            A connection test sends one bounded model request and may incur a small charge. Saving
            never calls the model.
          </p>
          {dirty && <p>Save changes before testing their connection.</p>}
          {controller.testMessage !== undefined && (
            <Status announcement="polite">{controller.testMessage}</Status>
          )}
        </Stack>
      </PanelBody>
    </Panel>
  );
}
