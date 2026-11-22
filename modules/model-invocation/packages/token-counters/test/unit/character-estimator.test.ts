import { expect, it } from 'vitest';
import { createCharacterTokenEstimator } from '../../src/index.js';

it('uses UTF-16 code units and preserves exact configuration identity', async () => {
  const counter = createCharacterTokenEstimator({ charactersPerToken: 1 });
  expect(counter.descriptor.measurementRef).toBe('estimate:utf16-code-units:ceil:per-token:1');
  const value = await counter.measure(
    { kind: 'text', text: '🐈e\u0301' },
    new AbortController().signal
  );
  expect(value).toMatchObject({ tokens: 4, accuracy: 'estimated' });
});
