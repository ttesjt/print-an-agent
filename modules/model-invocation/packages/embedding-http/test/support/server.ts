import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HttpTextEmbeddingConfig } from '../../src/index.js';

export async function embeddingServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void
) {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP server');
  const endpoint = `http://127.0.0.1:${address.port}/custom/embeddings`;
  return {
    endpoint,
    async close(this: void) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

export async function readRequest(request: IncomingMessage): Promise<unknown> {
  const buffers: Buffer[] = [];
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Expected HTTP bytes');
    buffers.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(buffers).toString('utf8'));
  return parsed;
}

export function httpConfig(endpoint: string): HttpTextEmbeddingConfig {
  return {
    endpoint,
    provider: 'test-provider',
    model: 'test-embedding',
    modelRef: 'test:weights-2026-10',
    dimensions: 2,
    authentication: { kind: 'keyless' },
    limits: { maxBatchSize: 4, maxInputUtf8Bytes: 1024, maxBatchUtf8Bytes: 4096 },
    maxResponseBytes: 4096,
    sendDimensions: false,
  };
}

/** Deterministic vectors prove the wire protocol, not semantic model quality. */
export function wireResponse() {
  return {
    object: 'list',
    model: 'test-embedding',
    data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
    usage: { prompt_tokens: 1, total_tokens: 1 },
  };
}
