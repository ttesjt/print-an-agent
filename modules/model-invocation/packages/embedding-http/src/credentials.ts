import {
  ModelInvocationError,
  type ProviderApiKeyCredential,
  type ProviderCredentialResolver,
  type ProviderModelReference,
} from '@print-an-agent/model-invocation-core';

function snapshotCredential(value: unknown): ProviderApiKeyCredential {
  let snapshot: { type: unknown; apiKey: unknown } | undefined;
  try {
    // Resolver-owned fields may be accessors; validate exactly the values we will use.
    snapshot =
      typeof value === 'object' && value !== null && 'type' in value && 'apiKey' in value
        ? { type: value.type, apiKey: value.apiKey }
        : undefined;
  } catch (cause: unknown) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Embedding resolver returned an invalid credential.',
      { cause }
    );
  }
  if (
    snapshot?.type !== 'api-key' ||
    typeof snapshot.apiKey !== 'string' ||
    snapshot.apiKey.length === 0 ||
    /[\r\n]/.test(snapshot.apiKey)
  ) {
    throw new ModelInvocationError(
      'MODEL_CREDENTIAL_RESOLUTION_FAILED',
      'Embedding resolver returned an invalid credential.'
    );
  }
  return Object.freeze({ type: 'api-key', apiKey: snapshot.apiKey });
}

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
  headers.Authorization = `Bearer ${snapshotCredential(credential).apiKey}`;
  return Object.freeze(headers);
}
