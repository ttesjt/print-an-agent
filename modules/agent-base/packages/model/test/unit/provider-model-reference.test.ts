import { describe, expect, it } from 'vitest';
import { AgentModelError, defineProviderModelReference } from '../../src/index.js';

function expectInvalidReference(action: () => void): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toBeInstanceOf(AgentModelError);
  if (received instanceof AgentModelError) {
    expect(received.code).toBe('MODEL_REFERENCE_INVALID');
  }
}

describe('Provider Model Reference', () => {
  it('validates and freezes provider-facing identity', () => {
    const reference = defineProviderModelReference({
      provider: 'local-openai',
      model: 'org/model-v2',
      baseUrl: 'http://127.0.0.1:8080/v1',
      credentialRef: 'vault://providers/local-openai',
    });

    expect(reference).toEqual({
      provider: 'local-openai',
      model: 'org/model-v2',
      baseUrl: 'http://127.0.0.1:8080/v1',
      credentialRef: 'vault://providers/local-openai',
    });
    expect(Object.isFrozen(reference)).toBe(true);
  });

  it.each([
    { provider: '', model: 'model' },
    { provider: 'provider', model: '../model' },
    { provider: 'provider with spaces', model: 'model' },
    { provider: 'provider', model: 'model', credentialRef: 'bad credential' },
  ])('rejects invalid identity components %#', (input) => {
    expectInvalidReference(() => defineProviderModelReference(input));
  });

  it('rejects non-http endpoints', () => {
    expectInvalidReference(() =>
      defineProviderModelReference({
        provider: 'provider',
        model: 'model',
        baseUrl: 'file:///private/model',
      })
    );
  });

  it.each([
    'https://user:secret@example.com/v1',
    'https://example.com/v1?api_key=secret',
    'https://example.com/v1#private',
  ])('rejects unsafe endpoint metadata: %s', (baseUrl) => {
    expectInvalidReference(() =>
      defineProviderModelReference({ provider: 'provider', model: 'model', baseUrl })
    );
  });

  it('rejects unknown reference fields', () => {
    expectInvalidReference(() =>
      defineProviderModelReference({
        provider: 'provider',
        model: 'model',
        secret: 'value',
      } as never)
    );
  });
});
