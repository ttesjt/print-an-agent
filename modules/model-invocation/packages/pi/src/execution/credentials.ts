import {
  ModelInvocationError,
  type ProviderApiKeyCredential,
  type ProviderCredentialResolver,
  type ProviderModelReference,
} from '@print-an-agent/model-invocation-core';
import { invocationInterruption } from './failures.js';

const MAX_API_KEY_CHARACTERS = 65_536;

function validateResolvedCredential(value: unknown): ProviderApiKeyCredential | undefined {
  if (value === undefined) return undefined;
  // Capture resolver-owned fields once; validate the same values that will reach Pi.
  const snapshot =
    typeof value === 'object' &&
    value !== null &&
    !Object.keys(value).some((key) => key !== 'type' && key !== 'apiKey') &&
    'type' in value &&
    'apiKey' in value
      ? { type: value.type, apiKey: value.apiKey }
      : undefined;
  if (
    snapshot?.type !== 'api-key' ||
    typeof snapshot.apiKey !== 'string' ||
    snapshot.apiKey.length === 0 ||
    snapshot.apiKey.length > MAX_API_KEY_CHARACTERS
  ) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Provider credential resolver returned an invalid API-key credential.'
    );
  }
  return Object.freeze({ type: 'api-key', apiKey: snapshot.apiKey });
}

export async function resolvePiApiKey(
  modelReference: ProviderModelReference,
  resolver: ProviderCredentialResolver | undefined,
  signal: AbortSignal
): Promise<string | undefined> {
  if (signal.aborted) throw invocationInterruption(signal);
  const credentialRef = modelReference.credentialRef;
  if (credentialRef === undefined) return undefined;
  if (resolver === undefined) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_NOT_FOUND',
      'Provider credential resolver is not configured.'
    );
  }
  let resolved: ProviderApiKeyCredential | undefined;
  try {
    resolved = validateResolvedCredential(
      await resolver.resolve(
        Object.freeze({
          reference: credentialRef,
          provider: modelReference.provider,
          signal,
        })
      )
    );
  } catch (cause: unknown) {
    if (signal.aborted) throw invocationInterruption(signal);
    if (
      cause instanceof ModelInvocationError &&
      cause.code === 'MODEL_CREDENTIAL_RESOLUTION_FAILED'
    ) {
      throw cause;
    }
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Provider credential resolution failed.',
      { cause }
    );
  }
  if (resolved === undefined) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_NOT_FOUND',
      'Provider credential is unavailable.'
    );
  }
  return resolved.apiKey;
}
