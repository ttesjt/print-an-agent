import {
  Checkbox,
  ConfigSection,
  FormField,
  Label,
  Select,
  Stack,
  TextInput,
} from '@print-an-agent/ui-react';
import type {
  AgentConfigFieldErrors,
  AgentWebConfig,
  AgentModelBinding,
  AgentProviderConfig,
} from '../application/agent-config.js';
import { ActorExecutionFields } from './actor-execution-fields.js';

export interface ModelConfigurationFieldsProps {
  readonly config: AgentWebConfig;
  readonly fieldErrors: AgentConfigFieldErrors;
  readonly onChange: (value: AgentWebConfig) => void;
  readonly prefix: string;
}

export function ModelConfigurationFields(props: ModelConfigurationFieldsProps) {
  const { config, onChange, fieldErrors, prefix } = props;
  const binding = config.model;
  const setModel = (model: AgentModelBinding) => onChange({ ...config, model });
  const value = binding.kind === 'provider' ? binding.config.kind : binding.kind;
  return (
    <Stack space="medium">
      <ConfigSection
        title="Model connection"
        description="This connection belongs to this Agent. Saving does not call the model."
      >
        <FormField
          controlId={`${prefix}-model-kind`}
          label="Model connection"
          error={fieldErrors.model}
        >
          {(control) => (
            <Select
              {...control}
              value={value}
              onChange={(event) => {
                const kind = event.currentTarget.value;
                if (kind === 'unconfigured') setModel({ kind });
                else if (kind === 'builtin' || kind === 'openai-compatible')
                  setModel({
                    kind: 'provider',
                    credential: null,
                    config:
                      kind === 'builtin'
                        ? { kind, reference: { provider: '', model: '' } }
                        : {
                            kind,
                            reference: { provider: '', model: '', baseUrl: '' },
                            contextWindowTokens: 0,
                            maxOutputTokens: 0,
                            supportsReasoning: false,
                            compatibility: { supportsDeveloperRole: false },
                          },
                  });
              }}
            >
              <option value="unconfigured">Configure later</option>
              <option value="builtin">Built-in provider catalog</option>
              <option value="openai-compatible">OpenAI-compatible endpoint</option>
              {binding.kind === 'engine' && (
                <option value="engine">Explicit host Engine · demonstration</option>
              )}
            </Select>
          )}
        </FormField>
        {binding.kind === 'unconfigured' && (
          <p>Conversation is unavailable until a model is configured.</p>
        )}
        {binding.kind === 'engine' && (
          <p>Host-installed Engine: {binding.engineId}. This is not a remote model connection.</p>
        )}
        {binding.kind === 'provider' && (
          <ProviderFields {...props} binding={binding} onModelChange={setModel} />
        )}
      </ConfigSection>
      <ActorExecutionFields {...props} />
    </Stack>
  );
}

function ProviderFields({
  binding,
  onModelChange,
  ...props
}: ModelConfigurationFieldsProps & {
  readonly binding: Extract<AgentModelBinding, { kind: 'provider' }>;
  readonly onModelChange: (binding: AgentModelBinding) => void;
}) {
  const provider = binding.config;
  const setProvider = (config: AgentProviderConfig) => onModelChange({ ...binding, config });
  const setReference = (key: 'provider' | 'model' | 'baseUrl', value: string) =>
    setProvider({ ...provider, reference: { ...provider.reference, [key]: value } });
  const field = (
    key: string,
    label: string,
    value: string | number,
    change: (value: string) => void,
    numeric = false
  ) => (
    <FormField
      controlId={`${props.prefix}-${key}`}
      label={label}
      error={props.fieldErrors[key]}
      required={key !== 'baseUrl' || provider.kind === 'openai-compatible'}
    >
      {(control) => (
        <TextInput
          {...control}
          type={numeric ? 'number' : 'text'}
          value={value}
          onChange={(event) => change(event.currentTarget.value)}
          {...(numeric ? { min: 1, step: 1 } : {})}
        />
      )}
    </FormField>
  );
  const setCredential = (reference: string, environmentVariable: string) =>
    onModelChange({
      ...binding,
      credential: { reference, environmentVariable },
      config: {
        ...provider,
        reference: { ...provider.reference, credentialRef: reference },
      },
    });
  return (
    <Stack space="medium">
      {field('provider', 'Provider', provider.reference.provider, (value) =>
        setReference('provider', value)
      )}
      {field('model', 'Model', provider.reference.model, (value) => setReference('model', value))}
      {field(
        'baseUrl',
        provider.kind === 'builtin' ? 'Base URL override · optional' : 'Base URL',
        provider.reference.baseUrl ?? '',
        (value) => {
          const reference = {
            provider: provider.reference.provider,
            model: provider.reference.model,
            ...(provider.reference.credentialRef === undefined
              ? {}
              : { credentialRef: provider.reference.credentialRef }),
          };
          setProvider({
            ...provider,
            reference:
              value === '' && provider.kind === 'builtin'
                ? reference
                : { ...reference, baseUrl: value },
          });
        }
      )}
      {provider.kind === 'builtin' ? (
        <p>
          Provider/model must exist in the installed catalog. Capabilities come from that catalog.
        </p>
      ) : (
        <>
          {field(
            'contextWindowTokens',
            'Model context window · tokens',
            provider.contextWindowTokens || '',
            (value) => setProvider({ ...provider, contextWindowTokens: Number(value) }),
            true
          )}
          {field(
            'modelMaxOutputTokens',
            'Model output capability · tokens',
            provider.maxOutputTokens || '',
            (value) => setProvider({ ...provider, maxOutputTokens: Number(value) }),
            true
          )}
          <Label>
            <Checkbox
              checked={provider.supportsReasoning}
              onChange={(event) =>
                setProvider({ ...provider, supportsReasoning: event.currentTarget.checked })
              }
            />
            Endpoint supports reasoning
          </Label>
          <Label>
            <Checkbox
              checked={provider.compatibility.supportsDeveloperRole}
              onChange={(event) =>
                setProvider({
                  ...provider,
                  compatibility: { supportsDeveloperRole: event.currentTarget.checked },
                })
              }
            />
            Endpoint supports developer instructions role
          </Label>
          <p>
            Capability declarations do not request reasoning generation. Local endpoints may support
            reasoning but require the system role.
          </p>
        </>
      )}
      <Label>
        <Checkbox
          checked={binding.credential !== null}
          onChange={(event) => {
            if (event.currentTarget.checked) setCredential('', '');
            else {
              const reference = {
                provider: provider.reference.provider,
                model: provider.reference.model,
                ...(provider.reference.baseUrl === undefined
                  ? {}
                  : { baseUrl: provider.reference.baseUrl }),
              };
              onModelChange({ ...binding, credential: null, config: { ...provider, reference } });
            }
          }}
        />
        Requires server credential
      </Label>
      {binding.credential !== null ? (
        <>
          {field('credentialRef', 'Credential reference', binding.credential.reference, (value) =>
            setCredential(value, binding.credential?.environmentVariable ?? '')
          )}
          {field(
            'environmentVariable',
            'Server environment variable',
            binding.credential.environmentVariable,
            (value) => setCredential(binding.credential?.reference ?? '', value)
          )}
          <p>
            Only the reference and variable name are saved. The host reads the key from its
            environment; no API key is entered here.
          </p>
        </>
      ) : (
        <p>
          {provider.kind === 'builtin'
            ? 'Builtin providers require a credential binding.'
            : 'Keyless endpoint. No credential is sent.'}
        </p>
      )}
    </Stack>
  );
}
