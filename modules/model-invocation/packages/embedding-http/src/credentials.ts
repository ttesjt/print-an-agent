import {
  ModelInvocationError,
  type ProviderCredentialResolver,
  type ProviderModelReference,
} from '@ta-agent/model-invocation-core';

export async function resolveEmbeddingHeaders(
  reference: ProviderModelReference,
  resolver: ProviderCredentialResolver | undefined,
  signal: AbortSignal
): Promise<Readonly<Record<string, string>>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (reference.credentialRef === undefined) return Object.freeze(headers);
  signal.throwIfAborted();
  if (resolver === undefined) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_NOT_FOUND',
      'Embedding credential is unavailable.'
    );
  }
  let credential: unknown;
  try {
    credential = await resolver.resolve({
      reference: reference.credentialRef,
      provider: reference.provider,
      signal,
    });
  } catch (cause: unknown) {
    signal.throwIfAborted();
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Embedding credential resolution failed.',
      { cause }
    );
  }
  signal.throwIfAborted();
  if (credential === undefined) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_NOT_FOUND',
      'Embedding credential is unavailable.'
    );
  }
  if (
    typeof credential !== 'object' ||
    credential === null ||
    !('type' in credential) ||
    credential.type !== 'api-key' ||
    !('apiKey' in credential) ||
    typeof credential.apiKey !== 'string' ||
    credential.apiKey.length === 0 ||
    /[\r\n]/.test(credential.apiKey)
  ) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Embedding resolver returned an invalid credential.'
    );
  }
  headers.Authorization = `Bearer ${credential.apiKey}`;
  return Object.freeze(headers);
}
