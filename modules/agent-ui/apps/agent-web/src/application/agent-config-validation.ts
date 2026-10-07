import type { AgentFieldError } from '@ta-agent/ui-contracts';
import {
  object,
  text,
  union,
  literal,
  integer,
  optional,
  type Decoder,
  TransportProtocolError,
} from '../transport/decoder.js';
import type { AgentWebConfig } from './agent-config.js';

export class AgentConfigValidationError extends Error {
  constructor(readonly fieldErrors: readonly AgentFieldError[]) {
    super('Check the Agent configuration fields.');
    this.name = 'AgentConfigValidationError';
  }
}

function field<T>(path: string, decoder: Decoder<T>): Decoder<T> {
  return {
    decode: (value) => {
      try {
        return decoder.decode(value);
      } catch (error) {
        if (error instanceof AgentConfigValidationError) throw error;
        if (!(error instanceof TransportProtocolError)) throw error;
        throw new AgentConfigValidationError([{ field: path, message: `Enter a valid ${path}.` }]);
      }
    },
  };
}
const nonBlank = (maximum: number): Decoder<string> => ({
  decode: (value) => {
    const parsed = text(maximum, 1).decode(value);
    if (parsed.trim().length === 0) throw new TransportProtocolError();
    return parsed;
  },
});
const boolean = union(literal(true), literal(false));
const timeout = union(literal(null), integer(1, 2_147_483_647));
const temperature: Decoder<number | null> = {
  decode: (value) => {
    if (
      value === null ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2)
    )
      return value;
    throw new TransportProtocolError();
  },
};
const reference = object({
  provider: field('provider', nonBlank(128)),
  model: field('model', nonBlank(256)),
  baseUrl: optional(field('baseUrl', nonBlank(4096))),
  credentialRef: optional(field('credentialRef', nonBlank(256))),
});
const provider = union(
  object({ kind: literal('builtin'), reference }),
  object({
    kind: literal('openai-compatible'),
    reference,
    contextWindowTokens: field('contextWindowTokens', integer(1)),
    maxOutputTokens: field('modelMaxOutputTokens', integer(1)),
    supportsReasoning: field('supportsReasoning', boolean),
    compatibility: object({ supportsDeveloperRole: field('supportsDeveloperRole', boolean) }),
  })
);
const model = union(
  object({ kind: literal('unconfigured') }),
  object({ kind: literal('engine'), engineId: nonBlank(128) }),
  object({
    kind: literal('provider'),
    config: provider,
    credential: union(
      literal(null),
      object({
        reference: field('credentialRef', nonBlank(256)),
        environmentVariable: field('environmentVariable', nonBlank(128)),
      })
    ),
  })
);
const schema = object({
  instructions: field('instructions', nonBlank(16_384)),
  responseStyle: union(literal('balanced'), literal('concise')),
  model: field('model', model),
  invocation: object({
    temperature: field('temperature', temperature),
    maxOutputTokens: field('actorMaxOutputTokens', union(literal(null), integer(1))),
  }),
  execution: object({
    requestTimeoutMilliseconds: field('requestTimeoutMilliseconds', timeout),
    actorTimeoutMilliseconds: field('actorTimeoutMilliseconds', timeout),
    responseStartTimeoutMilliseconds: field('responseStartTimeoutMilliseconds', timeout),
    streamEventIdleTimeoutMilliseconds: field('streamEventIdleTimeoutMilliseconds', timeout),
  }),
});

export function defineAgentWebConfig(input: unknown): AgentWebConfig {
  let config: AgentWebConfig;
  try {
    config = schema.decode(input);
  } catch (error) {
    if (error instanceof AgentConfigValidationError) throw error;
    throw new AgentConfigValidationError([
      { field: 'model', message: 'Unsupported or incomplete Agent configuration.' },
    ]);
  }
  const invalid = (field: string, message: string): never => {
    throw new AgentConfigValidationError([{ field, message }]);
  };
  if (config.model.kind === 'provider') {
    const { config: provider, credential } = config.model;
    if (
      credential?.reference !== provider.reference.credentialRef ||
      (credential !== null && !/^[A-Z_][A-Z0-9_]*$/u.test(credential.environmentVariable))
    ) {
      invalid(
        'environmentVariable',
        'Credential reference must match a valid server environment binding.'
      );
    }
    if (provider.kind === 'builtin' && credential === null)
      invalid('credentialRef', 'Builtin providers require a credential reference.');
    if (provider.reference.baseUrl !== undefined) {
      let url: URL;
      try {
        url = new URL(provider.reference.baseUrl);
      } catch {
        return invalid('baseUrl', 'Enter an absolute HTTP(S) endpoint.');
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        invalid(
          'baseUrl',
          'Endpoint must use HTTP(S) without embedded credentials, query, or fragment.'
        );
    }
    if (provider.kind === 'openai-compatible') {
      if (provider.reference.baseUrl === undefined)
        invalid('baseUrl', 'An endpoint URL is required.');
      if (provider.maxOutputTokens > provider.contextWindowTokens)
        invalid('modelMaxOutputTokens', 'Model output limit cannot exceed its context window.');
      if (
        config.invocation.maxOutputTokens !== null &&
        config.invocation.maxOutputTokens > provider.maxOutputTokens
      )
        invalid('actorMaxOutputTokens', 'Invocation output limit cannot exceed model capability.');
    }
  }
  freezeRecord(config);
  return config;
}

function freezeRecord(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const nested of Object.values(value)) freezeRecord(nested);
  Object.freeze(value);
}

export const AGENT_CONFIG_DECODER: Decoder<AgentWebConfig> = { decode: defineAgentWebConfig };
