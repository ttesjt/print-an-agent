import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { embeddingServer } from '../support/server.js';
import { wireResponse } from '../support/wire-response.js';

const execute = promisify(execFile);

it('runs a separate program using only built public package exports and no product runtime', async () => {
  const server = await embeddingServer((_request, response) => {
    response.end(JSON.stringify(wireResponse()));
  });
  try {
    const { stdout } = await execute(
      process.execPath,
      [fileURLToPath(new URL('../fixtures/public-consumer.ts', import.meta.url)), server.endpoint],
      { timeout: 5000 }
    );
    const result: unknown = JSON.parse(stdout);
    expect(result).toMatchObject({
      http: { task: 'query', embeddings: [{ id: 'query', vector: [1, 0] }] },
      asymmetric: { task: 'query', embeddings: [{ id: 'query', vector: [0, 11] }] },
      document: { task: 'document', embeddings: [{ id: 'document', vector: [11, 0] }] },
      recipeChangesIdentity: true,
    });
    if (
      typeof result !== 'object' ||
      result === null ||
      !('document' in result) ||
      !('asymmetric' in result)
    ) {
      throw new Error('Expected fixture results');
    }
    expect(result.document).toHaveProperty('representationRef');
    expect(result.asymmetric).toHaveProperty('representationRef');
  } finally {
    await server.close();
  }
});
