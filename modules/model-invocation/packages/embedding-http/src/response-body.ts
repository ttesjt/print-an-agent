import { EmbeddingError } from '@ta-agent/model-invocation-core';
import { isUint8Array } from 'node:util/types';

/** Own only this response body, not the shared fetch/client that produced it. */
export async function readEmbeddingResponseBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal
): Promise<unknown> {
  if (response.body === null) {
    throw new EmbeddingError('EMBEDDING_RESPONSE_INVALID', 'Embedding response has no body.');
  }
  const reader = response.body.getReader();
  let finished = false;
  let cancellation: Promise<void> | undefined;
  const cancel = (): void => {
    cancellation = reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const advertisedLength = Number(response.headers.get('content-length'));
    if (advertisedLength > maxResponseBytes) throw responseTooLarge();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (!finished) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) {
        finished = true;
        break;
      }
      const chunk: unknown = part.value;
      if (!isUint8Array(chunk)) {
        throw new EmbeddingError(
          'EMBEDDING_RESPONSE_INVALID',
          'Embedding body must contain bytes.'
        );
      }
      bytes += chunk.byteLength;
      if (bytes > maxResponseBytes) throw responseTooLarge();
      // Buffer.slice() aliases storage and typed-array subclasses can override slice().
      chunks.push(new Uint8Array(chunk));
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      const result: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(combined)
      );
      return result;
    } catch (cause: unknown) {
      throw new EmbeddingError(
        'EMBEDDING_RESPONSE_INVALID',
        'Embedding response is not valid UTF-8 JSON.',
        {
          cause,
        }
      );
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!finished) await reader.cancel().catch(() => undefined);
    await cancellation;
    reader.releaseLock();
  }
}

function responseTooLarge(): EmbeddingError {
  return new EmbeddingError(
    'EMBEDDING_RESPONSE_INVALID',
    'Embedding response exceeds its byte limit.'
  );
}
