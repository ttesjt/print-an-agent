import {
  EmbeddingError,
  type ProviderCredentialResolver,
  type TextEmbeddingRequest,
  type TextEmbeddingVector,
} from '@ta-agent/model-invocation-core';
import type { PreparedHttpEmbeddingConfig } from './config.js';
import { resolveEmbeddingHeaders } from './credentials.js';
import { readEmbeddingResponseBody } from './response-body.js';
import { decodeEmbeddingResponse } from './wire-response.js';

export interface HttpEmbeddingTransport {
  readonly config: PreparedHttpEmbeddingConfig;
  readonly credentialResolver: ProviderCredentialResolver | undefined;
  readonly fetch: typeof globalThis.fetch;
}

export async function requestHttpEmbeddings(
  transport: HttpEmbeddingTransport,
  request: TextEmbeddingRequest
): Promise<readonly TextEmbeddingVector[]> {
  const { config } = transport;
  if (request.inputs.some(({ text }) => text.length === 0)) {
    throw new EmbeddingError(
      'EMBEDDING_INPUT_INVALID',
      'HTTP embedding inputs cannot be empty strings.'
    );
  }
  const headers = await resolveEmbeddingHeaders(
    config.reference,
    transport.credentialResolver,
    request.signal
  );
  request.signal.throwIfAborted();
  const response = await transport.fetch(config.endpoint, {
    method: 'POST',
    headers,
    redirect: 'error',
    signal: request.signal,
    body: JSON.stringify({
      model: config.reference.model,
      input: request.inputs.map(({ text }) => text),
      encoding_format: 'float',
      ...(config.sendDimensions ? { dimensions: config.dimensions } : {}),
    }),
  });
  try {
    request.signal.throwIfAborted();
    if (!response.ok) {
      throw new EmbeddingError(
        'EMBEDDING_PROVIDER_FAILED',
        `Embedding endpoint returned HTTP ${response.status}.`
      );
    }
    return decodeEmbeddingResponse(
      await readEmbeddingResponseBody(response, config.maxResponseBytes, request.signal),
      request,
      config.reference.model
    );
  } finally {
    if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
  }
}
