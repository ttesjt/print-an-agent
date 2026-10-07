import type { AgentConfigCodec } from '@ta-agent/base-config';
import type { AgentFieldError } from '@ta-agent/ui-contracts';
import type { DemoAgentConfig } from '../../application/demo-agent-config.js';

export class WebInputError extends Error {
  constructor(readonly fieldErrors: readonly AgentFieldError[]) {
    super('The submitted fields are invalid.');
  }
}

export function defineWebAgentConfig(input: unknown): DemoAgentConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WebInputError([
      { field: 'instructions', message: 'Configuration must be a record.' },
    ]);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).some((key) => key !== 'instructions' && key !== 'responseStyle') ||
    Object.values(descriptors).some((field) => !Object.hasOwn(field, 'value'))
  )
    throw new WebInputError([
      { field: 'instructions', message: 'Unsupported configuration fields.' },
    ]);
  const instructions: unknown = descriptors.instructions?.value;
  const responseStyle: unknown = descriptors.responseStyle?.value;
  const errors: AgentFieldError[] = [];
  if (
    typeof instructions !== 'string' ||
    instructions.trim().length === 0 ||
    instructions.length > 16_384
  ) {
    errors.push({ field: 'instructions', message: 'Enter 1–16384 characters of instructions.' });
  }
  if (responseStyle !== 'balanced' && responseStyle !== 'concise') {
    errors.push({ field: 'responseStyle', message: 'Choose a supported response style.' });
  }
  if (
    errors.length > 0 ||
    typeof instructions !== 'string' ||
    (responseStyle !== 'balanced' && responseStyle !== 'concise')
  ) {
    throw new WebInputError(errors);
  }
  return Object.freeze({ instructions, responseStyle });
}

export const WEB_AGENT_CONFIG_CODEC: AgentConfigCodec<DemoAgentConfig> = Object.freeze({
  schemaVersion: 1,
  decode: defineWebAgentConfig,
  encode: (config: DemoAgentConfig) => ({ ...defineWebAgentConfig(config) }),
});
