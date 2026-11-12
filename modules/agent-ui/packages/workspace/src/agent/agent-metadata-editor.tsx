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
} from '@print-an-agent/ui-react';
import type { AgentMetadataController } from './use-agent-metadata.js';

export function AgentMetadataEditor({
  metadata,
  refresh,
}: {
  readonly metadata: AgentMetadataController;
  readonly refresh: () => void;
}) {
  return (
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
                <Button onClick={refresh}>Reload current identity</Button>
              </Alert>
            )}
          </Stack>
        </form>
      </PanelBody>
    </Panel>
  );
}
