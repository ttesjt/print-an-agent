import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { describe, expect, it } from 'vitest';
import { definePiProviderConfig } from '../../src/index.js';

function captureModelError(action: () => unknown): ModelInvocationError {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ModelInvocationError) return error;
    throw error;
  }
  throw new Error('Expected an ModelInvocationError.');
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
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      })
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });

  it.each([false, true])(
    'requires and preserves an explicit OpenAI-compatible reasoning capability of %s',
    (supportsReasoning) => {
      const config = definePiProviderConfig({
        kind: 'openai-compatible',
        reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning,
        compatibility: { supportsDeveloperRole: false },
      });

      expect(config).toMatchObject({
        supportsReasoning,
        compatibility: { supportsDeveloperRole: false },
      });
      expect(Object.isFrozen(config)).toBe(true);
      expect(config.kind).toBe('openai-compatible');
      if (config.kind !== 'openai-compatible') return;
      expect(Object.isFrozen(config.compatibility)).toBe(true);
    }
  );

  it.each([undefined, 'true', 1, null])(
    'rejects an invalid OpenAI-compatible reasoning capability of %s',
    (supportsReasoning) => {
      const error = captureModelError(() =>
        definePiProviderConfig({
          kind: 'openai-compatible',
          reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning,
          compatibility: { supportsDeveloperRole: false },
        })
      );
      expect(error.code).toBe('MODEL_REFERENCE_INVALID');
    }
  );

  it.each([false, true])(
    'requires and preserves an explicit OpenAI-compatible developer-role capability of %s',
    (supportsDeveloperRole) => {
      const config = definePiProviderConfig({
        kind: 'openai-compatible',
        reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole },
      });

      expect(config).toMatchObject({ compatibility: { supportsDeveloperRole } });
      expect(config.kind).toBe('openai-compatible');
      if (config.kind !== 'openai-compatible') return;
      expect(Object.isFrozen(config.compatibility)).toBe(true);
    }
  );

  it.each([undefined, null, [], 'unsupported'])(
    'rejects an invalid OpenAI-compatible compatibility object of %s',
    (compatibility) => {
      const error = captureModelError(() =>
        definePiProviderConfig({
          kind: 'openai-compatible',
          reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning: true,
          compatibility,
        })
      );
      expect(error.code).toBe('MODEL_REFERENCE_INVALID');
    }
  );

  it.each([undefined, null, 0, 'false'])(
    'rejects an invalid OpenAI-compatible developer-role capability of %s',
    (supportsDeveloperRole) => {
      const error = captureModelError(() =>
        definePiProviderConfig({
          kind: 'openai-compatible',
          reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
          supportsReasoning: true,
          compatibility: { supportsDeveloperRole },
        })
      );
      expect(error.code).toBe('MODEL_REFERENCE_INVALID');
    }
  );

  it('rejects unknown OpenAI-compatible compatibility fields', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'openai-compatible',
        reference: { provider: 'local', model: 'test', baseUrl: 'http://localhost:1234/v1' },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false, unsupported: true },
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
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      } as never)
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });

  it('keeps builtin reasoning capability under Pi catalog authority', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'builtin',
        reference: {
          provider: 'openai',
          model: 'gpt-4.1',
          credentialRef: 'credentials/openai',
        },
        supportsReasoning: false,
      } as never)
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });

  it('keeps builtin instruction-role compatibility under Pi catalog authority', () => {
    const error = captureModelError(() =>
      definePiProviderConfig({
        kind: 'builtin',
        reference: {
          provider: 'openai',
          model: 'gpt-4.1',
          credentialRef: 'credentials/openai',
        },
        compatibility: { supportsDeveloperRole: false },
      } as never)
    );
    expect(error.code).toBe('MODEL_REFERENCE_INVALID');
  });
});
