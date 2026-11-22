import type { IndexConfiguration, RetrievalSpace } from '../types/space.js';
import { exact, identifier, record, integer } from '../values/index.js';
import { COSINE_METRIC_REF } from '../representation/metric.js';
import { fail } from '../errors.js';

export function indexConfiguration(value: unknown): IndexConfiguration {
  const input = record(value);
  exact(input, ['embeddingRef', 'chunkerRef', 'metricRef']);
  return {
    embeddingRef: identifier(input.embeddingRef),
    chunkerRef: identifier(input.chunkerRef),
    metricRef: identifier(input.metricRef),
  };
}

export function parseRetrievalSpace(value: unknown): RetrievalSpace {
  const data = record(value);
  exact(data, ['memoryId', 'revision', 'sequence', 'index']);
  const index = record(data.index);
  exact(index, ['generationId', 'embeddingRef', 'chunkerRef', 'metricRef', 'dimensions']);
  if (index.metricRef !== COSINE_METRIC_REF)
    fail('UNSUPPORTED_CAPABILITY', 'Unsupported retrieval metric.');
  return {
    memoryId: identifier(data.memoryId),
    revision: integer(data.revision),
    sequence: integer(data.sequence, 0),
    index: {
      generationId: identifier(index.generationId),
      embeddingRef: identifier(index.embeddingRef),
      chunkerRef: identifier(index.chunkerRef),
      metricRef: COSINE_METRIC_REF,
      dimensions: integer(index.dimensions),
    },
  };
}
