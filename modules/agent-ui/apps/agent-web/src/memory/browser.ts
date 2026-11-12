import { fail, WEB_TRANSPORT_LIMITS } from '@print-an-agent/ui-transport';
import { type HttpTransportOptions } from '@print-an-agent/ui-transport/browser';
import {
  memoryCapabilities,
  type ContextMemoryPort,
  type RetrievalMemoryPort,
  type WebMemoryPorts,
} from './contracts.js';
import { contextCodecs } from './schemas/context.js';
import { retrievalCodecs } from './schemas/retrieval.js';
import type { Decoder } from '@print-an-agent/ui-transport';
import { assertMemoryReply } from './correlation.js';

/** Each returned port is permanently bound to this URL/Collection, never to a mutable active root. */
export async function connectHttpMemory(
  options: HttpTransportOptions = {},
  signal?: AbortSignal
): Promise<WebMemoryPorts> {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (options.baseUrl ?? '/api').replace(/\/$/u, '') + '/memory';
  async function call<I, O>(
    domain: 'context' | 'retrieval' | 'capabilities',
    operation: string,
    codec: { readonly input: Decoder<I>; readonly output: Decoder<O> },
    input: I & { readonly signal?: AbortSignal }
  ): Promise<O> {
    const { signal, ...payload } = input;
    signal?.throwIfAborted();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, operation, input: codec.input.decode(payload) }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json'))
      return fail();
    const reader = response.body?.getReader();
    if (reader === undefined) return fail();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > WEB_TRANSPORT_LIMITS.responseBytes) return fail();
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = codec.output.decode(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    );
    assertMemoryReply(operation, payload, result);
    return result;
  }
  const capabilities = await call(
    'capabilities',
    'inspect',
    {
      input: {
        decode: (input) => {
          if (typeof input !== 'object' || input === null || Reflect.ownKeys(input).length !== 0)
            return fail();
          return {};
        },
      },
      output: memoryCapabilities,
    },
    signal === undefined ? {} : { signal }
  );
  async function mutation<I extends { requestId: string; agentId: string; memoryId: string }, O>(
    domain: 'context' | 'retrieval',
    operation: string,
    codec: { readonly input: Decoder<I>; readonly output: Decoder<O> },
    input: I & { readonly signal?: AbortSignal }
  ): Promise<O> {
    // Validate BEFORE dispatch. Delivery loss cannot prove that an accepted mutation did not commit.
    const { signal, ...payload } = input;
    const parsed = codec.input.decode(payload);
    signal?.throwIfAborted();
    try {
      return await call(domain, operation, codec, {
        ...parsed,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      return codec.output.decode({
        status: 'indeterminate',
        notice: {
          code: 'MEMORY_DELIVERY_UNKNOWN',
          message: 'Read the receipt before retrying this same request.',
        },
        recovery: {
          agentId: parsed.agentId,
          memoryId: parsed.memoryId,
          requestId: parsed.requestId,
        },
      });
    }
  }
  const context: ContextMemoryPort | undefined =
    capabilities.context === undefined
      ? undefined
      : {
          inspect: (i) => call('context', 'inspect', contextCodecs.inspect, i),
          getReceipt: (i) => call('context', 'getReceipt', contextCodecs.getReceipt, i),
          readContext: (i) => call('context', 'readContext', contextCodecs.readContext, i),
          create: (i) => mutation('context', 'create', contextCodecs.create, i),
          apply: (i) => mutation('context', 'apply', contextCodecs.apply, i),
          configure: (i) => mutation('context', 'configure', contextCodecs.configure, i),
        };
  const retrieval: RetrievalMemoryPort | undefined =
    capabilities.retrieval === undefined
      ? undefined
      : {
          inspect: (i) => call('retrieval', 'inspect', retrievalCodecs.inspect, i),
          get: (i) => call('retrieval', 'get', retrievalCodecs.get, i),
          getReceipt: (i) => call('retrieval', 'getReceipt', retrievalCodecs.getReceipt, i),
          list: (i) => call('retrieval', 'list', retrievalCodecs.list, i),
          search: (i) => call('retrieval', 'search', retrievalCodecs.search, i),
          readContext: (i) => call('retrieval', 'readContext', retrievalCodecs.readContext, i),
          create: (i) => mutation('retrieval', 'create', retrievalCodecs.create, i),
          ingest: (i) => mutation('retrieval', 'ingest', retrievalCodecs.ingest, i),
          update: (i) => mutation('retrieval', 'update', retrievalCodecs.update, i),
          remove: (i) => mutation('retrieval', 'remove', retrievalCodecs.remove, i),
          reindex: (i) => mutation('retrieval', 'reindex', retrievalCodecs.reindex, i),
        };
  return Object.freeze({
    capabilities,
    ...(context === undefined ? {} : { context }),
    ...(retrieval === undefined ? {} : { retrieval }),
  });
}
