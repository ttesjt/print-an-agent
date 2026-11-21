import { expect, it, vi } from 'vitest';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../src/index.js';
import { httpConfig } from '../support/configuration.js';

it('rejects empty wire input before credential resolution and HTTP work', async () => {
  const resolve = vi.fn(() => Promise.resolve({ type: 'api-key', apiKey: 'fixture' } as const));
  const fetch = vi.fn<typeof globalThis.fetch>();
  const embedder = createHttpTextEmbedder({
    config: {
      ...httpConfig('https://example.test/embed'),
      authentication: { kind: 'credential-reference', credentialRef: 'fixture:key' },
    },
    credentialResolver: { resolve },
    fetch,
  });
  await expect(
    embedder.embed({
      task: EMBEDDING_TASK.QUERY,
      inputs: [{ id: 'empty', text: '' }],
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ code: 'EMBEDDING_INPUT_INVALID' });
  expect(resolve).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
