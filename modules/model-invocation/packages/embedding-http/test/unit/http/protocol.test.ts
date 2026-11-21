import { expect, it } from 'vitest';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { decodeEmbeddingResponse, encodeEmbeddingRequest } from '../../../src/http/protocol.js';

it('keeps Unicode and only includes explicitly requested dimension encoding', () => {
  const inputs = [{ id: 'one', text: 'e\u0301 🐈' }];
  for (const sendDimensions of [false, true]) {
    const encoded: unknown = JSON.parse(
      encodeEmbeddingRequest({ model: 'embedding', sendDimensions, dimensions: 2 }, inputs)
    );
    expect(encoded).toEqual({
      model: 'embedding',
      input: ['e\u0301 🐈'],
      encoding_format: 'float',
      ...(sendDimensions ? { dimensions: 2 } : {}),
    });
  }
});

it('associates provider indices and tolerates wire extensions without taking over Core ordering', () => {
  const result = decodeEmbeddingResponse(
    {
      object: 'list',
      model: 'embedding',
      future: true,
      data: [
        { object: 'embedding', index: 1, embedding: [0, 2], future: true },
        { object: 'embedding', index: 0, embedding: [1, 0] },
      ],
    },
    {
      task: EMBEDDING_TASK.QUERY,
      inputs: [
        { id: 'one', text: 'a' },
        { id: 'two', text: 'b' },
      ],
      signal: new AbortController().signal,
    },
    'embedding'
  );
  expect(result).toEqual([
    { id: 'two', vector: [0, 2] },
    { id: 'one', vector: [1, 0] },
  ]);
});
