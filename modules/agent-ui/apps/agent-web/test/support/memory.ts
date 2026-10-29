import { onTestFinished, vi } from 'vitest';
import { createCodepointChunker, COSINE_METRIC_REF } from '@ta-agent/retrieval-memory';
import {
  createTextEmbedder,
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  type TextEmbeddingRequest,
} from '@ta-agent/model-invocation-core';
import { createAgentBaseWebPorts } from '../../src/node/agent-base/backend.js';
import { startLocalAgentWebServer } from '../../src/node/transport/http-server.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { connectHttpMemory } from '../../src/memory/browser.js';
import type { WebMemoryOptions } from '../../src/node/memory/options.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';

export function memoryOptions() {
  const embed = vi.fn(({ inputs }: TextEmbeddingRequest) =>
    Promise.resolve(
      inputs.map(({ id, text }) => ({ id, vector: text.includes('dog') ? [0, 1] : [1, 0] }))
    )
  );
  const embedding = createTextEmbedder({
    representation: {
      modelRef: 'web-test',
      dimensions: 2,
      preprocessingRef: 'raw',
      documentRecipeRef: 'same',
      queryRecipeRef: 'same',
      outputTransformRef: 'raw',
    },
    limits: { maxBatchSize: 64, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed,
  });
  const counter = () => ({
    value: createTokenCounter({
      measurementRef: 'chars',
      inputContract: TEXT_TOKEN_INPUT_CONTRACT,
      measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
    }),
  });
  const index = {
    embeddingRef: embedding.descriptor.representationRef,
    chunkerRef: createCodepointChunker().ref,
    metricRef: COSINE_METRIC_REF,
  };
  const options: WebMemoryOptions = {
    provisioning: {
      storageNamespaceId: 'web-tests',
      context: { defaults: { measurementRef: 'chars' }, acquireCounter: counter },
      retrieval: {
        acquireEmbedding: () => ({ value: embedding }),
        measurementRef: 'chars',
        acquireCounter: counter,
      },
    },
    embeddings: [{ ...index, label: 'Fixture embedding' }],
  };
  return { options, index, embed };
}
export async function memoryHost(options: WebMemoryOptions | undefined = memoryOptions().options) {
  const backend = createAgentBaseWebPorts({
    persistence: { kind: 'memory' },
    ...(options === undefined ? {} : { memory: options }),
  });
  const server = await startLocalAgentWebServer({
    ports: backend,
    closeResources: () => backend.close(),
  });
  onTestFinished(() => server.close());
  const baseUrl = server.origin + '/api';
  const agents = createHttpAgentWebPorts({ baseUrl }).agents;
  const result = await agents.createAgent({
    identity: { agentId: 'a', displayName: 'Agent A' },
    config: DEFAULT_AGENT_CONFIG,
  });
  if (result.status !== 'succeeded') throw new Error('Agent fixture failed');
  return { backend, server, baseUrl, memory: await connectHttpMemory({ baseUrl }) };
}
