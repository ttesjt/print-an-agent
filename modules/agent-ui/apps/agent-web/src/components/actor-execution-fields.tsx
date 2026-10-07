import {
  ConfigSection,
  Disclosure,
  DisclosureSummary,
  DisclosurePanel,
  FormField,
  Stack,
  TextInput,
} from '@ta-agent/ui-react';
import type { AgentExecutionSettings } from '../application/agent-config.js';
import type { ModelConfigurationFieldsProps } from './model-configuration-fields.js';

export function ActorExecutionFields({
  config,
  onChange,
  fieldErrors,
  prefix,
}: ModelConfigurationFieldsProps) {
  const numeric = (
    key: string,
    label: string,
    value: number | null,
    onValue: (value: number | null) => void,
    temperature = false
  ) => (
    <FormField
      controlId={`${prefix}-${key}`}
      label={label}
      error={fieldErrors[key]}
      description="Leave empty to use no override."
    >
      {(control) => (
        <TextInput
          {...control}
          type="number"
          min={temperature ? 0 : 1}
          {...(temperature ? { max: 2, step: 0.1 } : { step: 1 })}
          value={value ?? ''}
          onChange={(event) =>
            onValue(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))
          }
        />
      )}
    </FormField>
  );
  const setInvocation = (key: 'temperature' | 'maxOutputTokens', value: number | null) =>
    onChange({ ...config, invocation: { ...config.invocation, [key]: value } });
  const timeout = (key: keyof AgentExecutionSettings, label: string) =>
    numeric(key, label, config.execution[key], (value) =>
      onChange({ ...config, execution: { ...config.execution, [key]: value } })
    );
  return (
    <Stack space="medium">
      <ConfigSection title="Actor generation">
        {numeric(
          'temperature',
          'Temperature · optional',
          config.invocation.temperature,
          (value) => setInvocation('temperature', value),
          true
        )}
        {numeric(
          'actorMaxOutputTokens',
          'Invocation output limit · tokens',
          config.invocation.maxOutputTokens,
          (value) => setInvocation('maxOutputTokens', value)
        )}
      </ConfigSection>
      <Disclosure>
        <DisclosureSummary>Advanced execution settings</DisclosureSummary>
        <DisclosurePanel>
          <Stack space="medium">
            <p>
              Empty means no local deadline; caller cancellation is always respected. Values are
              milliseconds.
            </p>
            {timeout('requestTimeoutMilliseconds', 'Request timeout · ms')}
            {timeout('actorTimeoutMilliseconds', 'Actor invocation timeout · ms')}
            {timeout('responseStartTimeoutMilliseconds', 'Provider response-start timeout · ms')}
            {timeout(
              'streamEventIdleTimeoutMilliseconds',
              'Provider stream-event idle timeout · ms'
            )}
          </Stack>
        </DisclosurePanel>
      </Disclosure>
    </Stack>
  );
}
