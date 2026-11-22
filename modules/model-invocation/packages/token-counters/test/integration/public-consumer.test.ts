import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
it('consumes only compiled public exports in a separate process with both bundled vocabularies', async () => {
  const inventory: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/public-api.json', import.meta.url), 'utf8')
  );
  if (typeof inventory !== 'object' || inventory === null || !('runtime' in inventory))
    throw new Error('Invalid public inventory');
  const { stdout } = await execute(
    process.execPath,
    [fileURLToPath(new URL('../fixtures/public-consumer.ts', import.meta.url))],
    { timeout: 15000 }
  );
  const result: unknown = JSON.parse(stdout);
  expect(result).toMatchObject({
    exports: inventory.runtime,
    measurements: [
      {
        tokens: 2,
        accuracy: 'exact',
        measurementRef: 'js-tiktoken:1.0.21:cl100k_base:ordinary-text',
      },
      {
        tokens: 2,
        accuracy: 'exact',
        measurementRef: 'js-tiktoken:1.0.21:o200k_base:ordinary-text',
      },
    ],
    estimated: { tokens: 2, accuracy: 'estimated' },
  });
});
