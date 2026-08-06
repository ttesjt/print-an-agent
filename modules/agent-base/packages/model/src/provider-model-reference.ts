import { AgentModelError } from './errors.js';
import type {
  ProviderId,
  ProviderModelId,
  ProviderModelReference,
  ProviderModelReferenceInput,
} from './types.js';

const PROVIDER_COMPONENT_MAX_LENGTH = 128;
const PROVIDER_COMPONENT_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/i;

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

function parseBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', 'Model base URL is invalid.', { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AgentModelError('MODEL_REFERENCE_INVALID', 'Model base URL must use http or https.');
  }
  return url.toString();
}

export function defineProviderModelReference(
  input: ProviderModelReferenceInput
): ProviderModelReference {
  const provider = parseComponent(input.provider, 'Provider ID') as ProviderId;
  const model = parseComponent(input.model, 'Provider model ID') as ProviderModelId;
  const baseUrl = parseBaseUrl(input.baseUrl);
  return Object.freeze({
    provider,
    model,
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
}
