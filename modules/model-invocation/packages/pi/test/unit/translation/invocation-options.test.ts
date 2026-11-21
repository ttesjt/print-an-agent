import { expect, it } from 'vitest';
import {
  invocationConfigFromPiOptions,
  toPiInvocationOptions,
} from '../../../src/translation/index.js';

it('round trips only the supported invocation controls without capturing credentials', () => {
  const config = { temperature: 0, maxOutputTokens: 128 };
  const options = toPiInvocationOptions(config, 'private-key');
  const snapshot = invocationConfigFromPiOptions(options);
  expect(options).toEqual({ temperature: 0, maxTokens: 128, apiKey: 'private-key' });
  expect(snapshot).toEqual(config);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain('private-key');
});

it('keeps absent controls absent', () => {
  expect(toPiInvocationOptions({}, undefined)).toEqual({});
  expect(invocationConfigFromPiOptions(undefined)).toEqual({});
});
