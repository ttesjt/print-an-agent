import { AgentModelError } from '@ta-agent/base-model';
import { describe, expect, it } from 'vitest';
import { definePiProviderConfig } from '../../src/index.js';

function captureModelError(action: () => unknown): AgentModelError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof AgentModelError) return error;
    throw error;
  }
  throw new Error('Expected an AgentModelError.');
}

describe('Pi provider configuration', () => {
  it('defines a closed builtin provider configuration with an explicit credential reference', () => {
    expect(
      definePiProviderConfig({
        kind: 'builtin',
        reference: {
          provider: 'openai',
          model: 'gpt-4.1',
          credentialRef: 'credentials/openai',
        },
      })
    ).toEqual({
      kind: 'builtin',
      reference: {
        provider: 'openai',
        model: 'gpt-4.1',
        credentialRef: 'credentials/openai',
      },
    });
  });

  it('requires credentials for builtin providers', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'builtin',
        reference: { provider: 'openai', model: 'gpt-4.1' },
      })
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });

  it('requires explicit compatible endpoint bounds', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'openai-compatible',
        reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
        contextWindowTokens: 1_000,
        maxOutputTokens: 1_001,
      })
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });

  it('rejects unknown configuration fields', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'builtin',
        reference: {
          provider: 'openai',
          model: 'gpt-4.1',
          credentialRef: 'credentials/openai',
        },
        apiKey: 'must-not-be-inline',
      } as never)
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });

  it('rejects source-specific fields on a builtin profile', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'builtin',
        reference: {
          provider: 'openai',
          model: 'gpt-4.1',
          credentialRef: 'credentials/openai',
        },
        contextWindowTokens: 8_192,
      } as never)
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });
});
