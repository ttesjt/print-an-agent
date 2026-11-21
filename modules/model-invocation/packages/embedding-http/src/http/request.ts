import {
  EmbeddingError,
  type ProviderCredentialResolver,
  type TextEmbeddingRequest,
  type TextEmbeddingVector,
} from '@print-an-agent/model-invocation-core';
import type { HttpEmbeddingTarget } from '../configuration/index.js';
import { resolveEmbeddingAuthorization } from '../authentication.js';
import { readEmbeddingResponseBody } from './response-body.js';
import {
  decodeEmbeddingResponse,
  encodeEmbeddingRequest,
  validateHttpEmbeddingInputs,
} from './protocol.js';

interface HttpEmbeddingRequestOptions extends HttpEmbeddingTarget {
  readonly dimensions: number;
  readonly credentialResolver: ProviderCredentialResolver | undefined;
  readonly fetch: typeof globalThis.fetch;
}

export async function requestHttpEmbeddings(
  transport: HttpEmbeddingRequestOptions,
  request: TextEmbeddingRequest
): Promise<readonly TextEmbeddingVector[]> {
  validateHttpEmbeddingInputs(request.inputs);
  const authorization = await resolveEmbeddingAuthorization(
    transport.reference,
    transport.credentialResolver,
    request.signal
  );
  request.signal.throwIfAborted();
  const response = await transport.fetch(transport.endpoint, {
    method: 'POST',
    headers: Object.freeze({
      'Content-Type': 'application/json',
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    }),
    redirect: 'error',
    signal: request.signal,
    body: encodeEmbeddingRequest(
      {
        model: transport.reference.model,
        sendDimensions: transport.sendDimensions,
        dimensions: transport.dimensions,
      },
      request.inputs
    ),
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
      await readEmbeddingResponseBody(response, transport.maxResponseBytes, request.signal),
      request,
      transport.reference.model
    );
  } finally {
    if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
  }
}
