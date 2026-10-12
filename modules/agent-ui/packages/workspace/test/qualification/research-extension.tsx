import { useState } from 'react';
import type { MutationOutcome } from '@ta-agent/ui-contracts';
import {
  Alert,
  Button,
  Dialog,
  FormField,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  TextInput,
} from '@ta-agent/ui-react';
import {
  useRevisionedEditor,
  useWorkspaceBoundary,
  useWorkspaceMutation,
  type WorkspaceExtension,
} from '@ta-agent/ui-workspace';
import type { ResearchBackend } from './research-backend.js';

function Outcome({ result }: { readonly result: MutationOutcome<unknown> | undefined }) {
  if (result === undefined) return null;
  return (
    <Alert tone={result.status === 'committed' ? 'neutral' : 'caution'}>
      {result.status === 'committed'
        ? result.notices.map((n) => n.message).join('; ')
        : result.status === 'rejected'
          ? result.failure.message
          : result.notice.message}
    </Alert>
  );
}
/** A consumer with two typed authorities, no default application config or state-controller copy. */
export function researchExtension(backend: ResearchBackend): WorkspaceExtension {
  return function ResearchExtension({ agent, children, onCreated }) {
    const id = agent?.agentId ?? 'unselected';
    const [createOpen, setCreateOpen] = useState(false);
    const preferences = useRevisionedEditor({
      scope: `${backend.collection.key}/${id}/preferences`,
      equals: (a, b) => a.strategy === b.strategy && a.datasets.join(',') === b.datasets.join(','),
      read: () => Promise.resolve(backend.readPreferences(id)),
      save: (input) => backend.savePreferences(id, input),
    });
    const compute = useRevisionedEditor({
      scope: `${backend.collection.key}/${id}/compute`,
      equals: (a, b) => a.pool.region === b.pool.region && a.pool.slots === b.pool.slots,
      read: () => Promise.resolve(backend.readCompute(id)),
      save: () => backend.saveCompute(),
    });
    const creation = useWorkspaceMutation<void, { agentId: string }>({
      scope: `${backend.collection.key}/create`,
      execute: () => backend.create(),
      onCommitted: ({ agentId }) => {
        setCreateOpen(false);
        onCreated(agentId);
      },
    });
    const boundary = useWorkspaceBoundary([
      preferences.boundary,
      compute.boundary,
      {
        dirty: createOpen,
        working: creation.pending,
        editIdentity: undefined,
        discard: () => setCreateOpen(false),
      },
    ]);
    return children({
      boundary,
      requestCreate: () => setCreateOpen(true),
      settings: (
        <Stack>
          <Outcome result={creation.result} />
          <Panel>
            <PanelHeader>Dataset preferences</PanelHeader>
            <PanelBody>
              <Stack>
                <span>{preferences.snapshot?.revision}</span>
                <FormField label="Datasets" controlId="research-datasets">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={preferences.draft?.datasets.join(',') ?? ''}
                      onChange={(e) => {
                        if (preferences.draft)
                          preferences.setDraft({
                            ...preferences.draft,
                            datasets: e.currentTarget.value.split(','),
                          });
                      }}
                    />
                  )}
                </FormField>
                <Button
                  pending={preferences.pending}
                  disabled={!preferences.dirty || preferences.loading}
                  onClick={() => void preferences.save()}
                >
                  Save datasets
                </Button>
                <Button onClick={() => void preferences.reload()}>Reload datasets</Button>
                <Outcome result={preferences.result} />
              </Stack>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>Compute allocation</PanelHeader>
            <PanelBody>
              <Stack>
                <span>{compute.snapshot?.revision}</span>
                <FormField label="Region" controlId="research-region">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={compute.draft?.pool.region ?? ''}
                      onChange={(e) => {
                        if (compute.draft)
                          compute.setDraft({
                            pool: { ...compute.draft.pool, region: e.currentTarget.value },
                          });
                      }}
                    />
                  )}
                </FormField>
                <Button
                  pending={compute.pending}
                  disabled={!compute.dirty || compute.loading}
                  onClick={() => void compute.save()}
                >
                  Save compute
                </Button>
                <Outcome result={compute.result} />
              </Stack>
            </PanelBody>
          </Panel>
        </Stack>
      ),
      createDialog: (
        <Dialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="New research identity"
          footer={
            <Button pending={creation.pending} onClick={() => void creation.run()}>
              Provision research Agent
            </Button>
          }
        >
          <p>Identity creation is durable even if dataset preparation fails.</p>
          <Outcome result={creation.result} />
        </Dialog>
      ),
    });
  };
}
