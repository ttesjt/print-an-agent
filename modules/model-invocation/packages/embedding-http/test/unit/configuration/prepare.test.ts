import { expect, it, vi } from 'vitest';
import { createHttpTextEmbedder } from '../../../src/index.js';
import { httpConfig } from '../../support/configuration.js';

const endpoint = 'http://127.0.0.1:1234/embedding';

function buildUnknown(options: unknown): void {
  Reflect.apply(createHttpTextEmbedder, undefined, [options]);
}

it.each([
  { extra: true },
  { endpoint: 'file:///tmp/embedding' },
  { endpoint: 'https://name:secret@example.test/embedding' },
  { endpoint: 'https://example.test/embedding?key=secret' },
  { endpoint: 'https://example.test/embedding#fragment' },
  { sendDimensions: undefined },
  { sendDimensions: 'true' },
  { maxResponseBytes: 0 },
  { maxResponseBytes: Infinity },
  { dimensions: 0 },
  { modelRef: undefined },
  { authentication: { kind: 'ambient' } },
  { authentication: { kind: 'keyless', credentialRef: 'secret' } },
  { authentication: { kind: 'credential-reference' } },
  { authentication: { kind: 'keyless', extra: true } },
  { limits: { maxBatchSize: null } },
])('rejects invalid config %#', (change) => {
  expect(() => buildUnknown({ config: { ...httpConfig(endpoint), ...change } })).toThrow();
});

it('rejects getters and unknown options without executing accessors', () => {
  const getter = vi.fn();
  const config = httpConfig(endpoint);
  Object.defineProperty(config, 'modelRef', { enumerable: true, get: getter });
  expect(() => createHttpTextEmbedder({ config })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => buildUnknown({ config: httpConfig(endpoint), extra: true })).toThrow();
});
