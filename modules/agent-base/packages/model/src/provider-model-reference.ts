import { AgentModelError } from './errors.js';
import type {
  ProviderId,
  ProviderCredentialReference,
  ProviderModelId,
  ProviderModelReference,
} from './types.js';

const PROVIDER_COMPONENT_MAX_LENGTH = 128;
const PROVIDER_COMPONENT_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/i;
const PROVIDER_MODEL_REFERENCE_KEYS = Object.freeze([
  'provider',
  'model',
  'baseUrl',
  'credentialRef',
]);

function parseComponent(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length > PROVIDER_COMPONENT_MAX_LENGTH ||
    !PROVIDER_COMPONENT_PATTERN.test(value)
  ) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      `${label} must contain 1-${PROVIDER_COMPONENT_MAX_LENGTH} letters, digits, dots, underscores, colons, slashes, or hyphens.`
    );
  }
  return value;
}

function parseBaseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', 'Model base URL must be a string.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', 'Model base URL is invalid.', { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', 'Model base URL must use http or https.');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'Model base URL cannot contain credentials, query parameters, or a fragment.'
    );
  }
  return url.toString();
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function defineProviderModelReference(input: unknown): ProviderModelReference {
  if (!isUnknownRecord(input)) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      'Provider Model Reference must be an object.'
    );
  }
  const unexpected = Object.keys(input).find((key) => !PROVIDER_MODEL_REFERENCE_KEYS.includes(key));
  if (unexpected !== undefined) {
    throw new AgentModelError(
      'MODEL_REFERENCE_INVALID',
      `Provider Model Reference contains unsupported field "${unexpected}".`
    );
  }
  const provider = parseComponent(input.provider, 'Provider ID') as ProviderId;
  const model = parseComponent(input.model, 'Provider model ID') as ProviderModelId;
  const baseUrl = parseBaseUrl(input.baseUrl);
  const credentialRef =
    input.credentialRef === undefined
      ? undefined
      : (parseComponent(
          input.credentialRef,
          'Provider credential reference'
        ) as ProviderCredentialReference);
  return Object.freeze({
    provider,
    model,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(credentialRef === undefined ? {} : { credentialRef }),
  });
}
