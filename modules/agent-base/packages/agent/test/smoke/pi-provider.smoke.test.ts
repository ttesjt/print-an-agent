import { DEFAULT_REQUEST_POLICY } from '@ta-agent/base-request';
import type { PiProviderConfigInput } from '@ta-agent/base-pi';
import { describe, expect, it } from 'vitest';
import { createPiAgentBase } from '../../src/index.js';

const smokeEnabled = process.env.TA_AGENT_PI_SMOKE === '1';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Provider smoke requires environment variable ${name}.`);
  }
  return value;
}

function providerConfig(): PiProviderConfigInput {
  const kind = process.env.TA_AGENT_PI_SMOKE_KIND ?? 'builtin';
  const provider = requiredEnvironment('TA_AGENT_PI_SMOKE_PROVIDER');
  const model = requiredEnvironment('TA_AGENT_PI_SMOKE_MODEL');
  if (kind === 'builtin') {
    return {
      kind,
      reference: {
        provider,
        model,
        credentialRef: 'smoke/provider-api-key',
        ...(process.env.TA_AGENT_PI_SMOKE_BASE_URL === undefined
          ? {}
          : { baseUrl: process.env.TA_AGENT_PI_SMOKE_BASE_URL }),
      },
    };
  }
  if (kind === 'openai-compatible') {
    return {
      kind,
      reference: {
        provider,
        model,
        baseUrl: requiredEnvironment('TA_AGENT_PI_SMOKE_BASE_URL'),
        credentialRef: 'smoke/provider-api-key',
      },
      contextWindowTokens: Number(process.env.TA_AGENT_PI_SMOKE_CONTEXT_WINDOW_TOKENS ?? '32768'),
      maxOutputTokens: Number(process.env.TA_AGENT_PI_SMOKE_MAX_OUTPUT_TOKENS ?? '512'),
    };
  }
  throw new Error('TA_AGENT_PI_SMOKE_KIND must be builtin or openai-compatible.');
}

describe.skipIf(!smokeEnabled)('ordinary Pi provider smoke', () => {
  it('performs one bounded, no-tool Agent request through the configured provider', async () => {
    const agent = createPiAgentBase({
      identity: { id: 'provider-smoke' },
      requestPolicy: {
        ...DEFAULT_REQUEST_POLICY,
        maxProviderTurns: 1,
        timeoutMilliseconds: 30_000,
      },
      mainActor: { invocationConfig: { temperature: 0, maxOutputTokens: 64 } },
      pi: {
        provider: providerConfig(),
        credentialResolver: {
          resolve: () =>
            Promise.resolve({
              type: 'api-key',
              apiKey: requiredEnvironment('TA_AGENT_PI_SMOKE_API_KEY'),
            }),
        },
      },
    });

    const response = await agent.run({
      message: 'Reply with exactly the word ready.',
    });

    expect(response.message.text.length).toBeGreaterThan(0);
  });
});
