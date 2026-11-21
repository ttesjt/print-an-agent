import { expect, it, vi } from 'vitest';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../../src/index.js';
import { httpConfig } from '../../support/configuration.js';
it('rejects unsupported empty wire text without calling the network', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const embedder = createHttpTextEmbedder({
    config: httpConfig('https://example.test/embed'),
    fetch,
  });
  await expect(
    embedder.embed({
      task: EMBEDDING_TASK.DOCUMENT,
      inputs: [{ id: 'empty', text: '' }],
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ code: 'EMBEDDING_INPUT_INVALID' });
  expect(fetch).not.toHaveBeenCalled();
});
