import type { AgentSnapshot } from '@ta-agent/ui-contracts';
import {
  AgentConfigForm,
  AgentDetailsView,
  Alert,
  Button,
  ConfigSection,
  FormField,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Stack,
  Status,
  Textarea,
} from '@ta-agent/ui-react';

import type { DemoAgentConfig } from '../application/demo-agent-config.js';

export type AgentSelectionState =
  | Readonly<{ status: 'failed'; error: string }>
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; snapshot: AgentSnapshot<DemoAgentConfig> }>;

export interface AgentWorkspaceProps {
  readonly configConflict: string | undefined;
  readonly configDirty: boolean;
  readonly configDraft: DemoAgentConfig;
  readonly configError: string | undefined;
  readonly configFieldErrors: DemoConfigFieldErrors;
  readonly onReloadConfig: () => void;
  readonly onResetConfig: () => void;
  readonly onSaveConfig: () => void;
  readonly selectionState: AgentSelectionState;
  readonly setConfigDraft: (config: DemoAgentConfig) => void;
  readonly working: boolean;
}

export function AgentWorkspace({
  configConflict,
  configDirty,
  configDraft,
  configError,
  configFieldErrors,
  onReloadConfig,
  onResetConfig,
  onSaveConfig,
  selectionState,
  setConfigDraft,
  working,
}: AgentWorkspaceProps) {
  if (selectionState.status === 'idle') {
    return <Status>Select an Agent or create a new one.</Status>;
  }
  if (selectionState.status === 'loading') {
    return <Status announcement="polite">Loading Agent details…</Status>;
  }
  if (selectionState.status === 'failed') {
    return (
      <Alert announcement="assertive" tone="critical">
        {selectionState.error}
      </Alert>
    );
  }

  return (
    <Stack space="large">
      <AgentDetailsView
        agent={selectionState.snapshot.details}
        formatTimestamp={formatTimestamp}
        labels={{
          agentId: 'Agent ID',
          createdAt: 'Created',
          identityRevision: 'Identity revision',
          status: 'Status',
          updatedAt: 'Updated',
        }}
        statusLabels={{ active: 'Active', disabled: 'Disabled' }}
      />
      <Panel>
        <PanelHeader>
          <h2>Configuration</h2>
          <p>Application-defined fields remain outside the generic Agent UI contract.</p>
        </PanelHeader>
        <PanelBody>
          <AgentConfigForm
            cancelLabel="Discard changes"
            conflict={configConflict}
            conflictActions={
              configConflict === undefined ? undefined : (
                <Button appearance="outline" onClick={onReloadConfig} size="small" tone="neutral">
                  Reload current version
                </Button>
              )
            }
            dirty={configDirty}
            error={configError}
            invalid={configConflict !== undefined || configFieldErrors.instructions !== undefined}
            onReset={onResetConfig}
            onSubmit={onSaveConfig}
            pending={working}
            saveLabel="Save configuration"
          >
            <ConfigSection
              description="These fields are supplied by the Agent Web application."
              title="Interaction"
            >
              <DemoConfigFields
                config={configDraft}
                fieldErrors={configFieldErrors}
                onChange={setConfigDraft}
                prefix="settings"
              />
            </ConfigSection>
          </AgentConfigForm>
        </PanelBody>
      </Panel>
    </Stack>
  );
}

export function DemoConfigFields({
  config,
  fieldErrors = {},
  onChange,
  prefix,
}: Readonly<{
  config: DemoAgentConfig;
  fieldErrors?: DemoConfigFieldErrors;
  onChange: (config: DemoAgentConfig) => void;
  prefix: string;
}>) {
  return (
    <Stack space="medium">
      <FormField
        controlId={`${prefix}-instructions`}
        error={fieldErrors.instructions}
        label="Instructions"
        required
      >
        {(controlProps) => (
          <Textarea
            {...controlProps}
            onChange={(event) => onChange({ ...config, instructions: event.currentTarget.value })}
            rows={4}
            value={config.instructions}
          />
        )}
      </FormField>
      <FormField controlId={`${prefix}-response-style`} label="Response style">
        {(controlProps) => (
          <Select
            {...controlProps}
            onChange={(event) =>
              onChange({
                ...config,
                responseStyle: event.currentTarget.value === 'concise' ? 'concise' : 'balanced',
              })
            }
            value={config.responseStyle}
          >
            <option value="balanced">Balanced</option>
            <option value="concise">Concise</option>
          </Select>
        )}
      </FormField>
    </Stack>
  );
}

export interface DemoConfigFieldErrors {
  readonly instructions?: string;
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}
