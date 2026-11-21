import type { HttpTextEmbeddingConfig } from '../../src/index.js';

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
