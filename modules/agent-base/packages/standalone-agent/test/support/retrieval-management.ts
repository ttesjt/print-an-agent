import { expect, onTestFinished, vi } from 'vitest';
import {
  createAgentManagementService,
  createRetrievalMemoryManagementService,
} from '@print-an-agent/base-composition';
import {
  createTextEmbedder,
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  type TextEmbeddingRequest,
} from '@print-an-agent/model-invocation-core';
import {
  COSINE_METRIC_REF,
  createCodepointChunker,
  type RetrievalMutationOutcome,
} from '@print-an-agent/retrieval-memory';
import {
  createStandaloneMemorySetup,
  type StandaloneRetrievalMemoryOptions,
} from '../../src/index.js';
import { resourceProfileConfig } from './resource-profile.js';

export const target = { agentId: 'a', memoryId: 'knowledge' };
export function modelFixture() {
  const embed = vi.fn(({ inputs }: TextEmbeddingRequest) =>
    Promise.resolve(
      inputs.map(({ id, text }) => ({ id, vector: text.includes('dog') ? [0, 1] : [1, 0] }))
    )
  );
  const embedding = createTextEmbedder({
    representation: {
      modelRef: 'test:memory',
      dimensions: 2,
      preprocessingRef: 'raw',
      documentRecipeRef: 'same',
      queryRecipeRef: 'same',
      outputTransformRef: 'raw',
    },
    limits: { maxBatchSize: 64, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed,
  });
  const chunker = createCodepointChunker();
  const acquireEmbedding = vi.fn(() => ({ value: embedding }));
  const acquireChunker = vi.fn(() => ({ value: chunker }));
  const options: StandaloneRetrievalMemoryOptions = {
    acquireEmbedding,
    acquireChunker,
    measurementRef: 'chars',
    acquireCounter: () => ({
      value: createTokenCounter({
        measurementRef: 'chars',
        inputContract: TEXT_TOKEN_INPUT_CONTRACT,
        measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
      }),
    }),
  };
  return {
    embedding,
    chunker,
    embed,
    acquireEmbedding,
    acquireChunker,
    options,
    index: {
      embeddingRef: embedding.descriptor.representationRef,
      chunkerRef: chunker.ref,
      metricRef: COSINE_METRIC_REF,
    },
  };
}
export function receipt(result: RetrievalMutationOutcome) {
  expect(result.status).not.toBe('skipped');
  if (result.status === 'skipped') throw new Error('Unexpected skip');
  return result.receipt;
}
export async function retrievalFixture(options: StandaloneRetrievalMemoryOptions = {}) {
  const model = modelFixture();
  const setup = createStandaloneMemorySetup(
    {
      readEnvironmentVariable: () => {
        throw new Error('No credentials');
      },
    },
    { storageNamespaceId: 'retrieval-test', retrieval: { ...model.options, ...options } }
  );
  onTestFinished(() => setup.close({ mode: 'abort' }));
  const agents = createAgentManagementService(setup.definition);
  await agents.create({ identity: { id: 'a' }, config: resourceProfileConfig() });
  const capability = setup.definition.retrievalMemoryManagement;
  if (capability === undefined) throw new Error('Fixture must install Retrieval management');
  const definition = { ...setup.definition, retrievalMemoryManagement: capability };
  const service = createRetrievalMemoryManagementService(definition);
  await service.create({ ...target, requestId: 'create', index: model.index });
  return { setup, definition, agents, service, ...model };
}
