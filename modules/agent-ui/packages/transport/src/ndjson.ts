import { fail } from './decoder.js';
import { WEB_TRANSPORT_LIMITS } from './limits.js';

/** Bounded UTF-8 line delivery. Business event validation and terminal policy belong to callers. */
export async function readNdjsonResponse(
  response: Response,
  consume: (line: string) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('application/x-ndjson') ||
    response.body === null
  ) {
    await response.body?.cancel().catch(() => undefined);
    return fail();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  let buffer = '';
  let bytes = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > WEB_TRANSPORT_LIMITS.streamBytes) return fail();
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        if (encoder.encode(line).byteLength > WEB_TRANSPORT_LIMITS.frameBytes) return fail();
        await consume(line);
        signal?.throwIfAborted();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (encoder.encode(buffer).byteLength > WEB_TRANSPORT_LIMITS.frameBytes) return fail();
    }
    buffer += decoder.decode();
    if (buffer.length !== 0) return fail();
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
