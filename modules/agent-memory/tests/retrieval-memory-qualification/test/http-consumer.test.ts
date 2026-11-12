import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHttpTextEmbedder } from '@print-an-agent/model-invocation-embedding-http';
import { createTiktokenTextCounter } from '@print-an-agent/model-invocation-token-counters';
import { expect, it, onTestFinished } from 'vitest';
import { composeProjectKnowledge } from '../examples/project-knowledge.js';
import { fixture } from './support/fixture.js';
it('consumes actual HTTP embeddings, SQLite and bundled exact measurement using only public imports', async () => {
  const f = await fixture('sqlite');
  const requests: unknown[] = [];
  async function handle(request: IncomingMessage, response: ServerResponse) {
    request.setEncoding('utf8');
    let body = '';
    for await (const chunk of request) {
      if (typeof chunk !== 'string') throw new Error('Unexpected HTTP input');
      body += chunk;
    }
    const input = JSON.parse(body) as { model: string; input: string[] };
    requests.push(input);
    expect(request.headers.authorization).toBeUndefined();
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        object: 'list',
        model: input.model,
        data: input.input
          .map((_, index) => ({ object: 'embedding', index, embedding: [1e20, 0, 0, 0] }))
          .reverse(),
      })
    );
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing server address');
  const embedder = createHttpTextEmbedder({
    config: {
      endpoint: `http://127.0.0.1:${address.port}/embeddings`,
      provider: 'fixture',
      model: 'fixture-model',
      modelRef: 'fixture-model:v1',
      dimensions: 4,
      authentication: { kind: 'keyless' },
      limits: { maxBatchSize: 8, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
      maxResponseBytes: 10000,
      sendDimensions: false,
    },
  });
  const counter = createTiktokenTextCounter({ encoding: 'o200k_base' });
  const { bundle, index } = composeProjectKnowledge({
    backend: f.ports.backend,
    embedder,
    counter,
  });
  await bundle.workflows.create.run({ input: { memoryId: 'project', requestId: 'create', index } });
  const saved = await bundle.workflows.ingest.run({
    input: {
      memoryId: 'project',
      requestId: 'a',
      content: 'Keep the database and index publication atomic.',
      source: { ref: 'design:1' },
    },
  });
  expect(saved.status).toBe('committed');
  const result = await bundle.workflows.readContext.run({
    input: { memoryId: 'project', query: 'How is publication coordinated?', maxTokens: 128 },
  });
  if (result.status !== 'completed') throw new Error('Unexpected skip');
  expect(result.value.text).toContain('publication atomic');
  expect(result.value.measurement).toMatchObject({
    accuracy: 'exact',
    scope: 'text',
    measurementRef: counter.descriptor.measurementRef,
  });
  expect(result.value.measurement!.tokens).toBeLessThanOrEqual(128);
  expect(requests).toHaveLength(2);
  expect(await f.ports.backend.inspect('project')).toMatchObject({ sequence: 1 }); // Bundle did not close borrowed storage.
});
