import { expect, it } from 'vitest';
import {
  createActor,
  requireCompletionCapability,
  type ProviderCredentialResolver,
} from '@print-an-agent/model-invocation-core';
import { createPiProviderRuntime } from '../../../src/index.js';
import { completionServer } from '../../support/completion-server.js';

function provider(baseUrl = 'http://127.0.0.1:1/v1') {
  return {
    kind: 'openai-compatible' as const,
    reference: { provider: 'fixture', model: 'fixture', baseUrl, credentialRef: 'test:credential' },
    contextWindowTokens: 4096,
    maxOutputTokens: 256,
    supportsReasoning: false,
    compatibility: { supportsDeveloperRole: false },
  };
}

it('uses the single validated credential snapshot for readiness and real provider requests', async () => {
  const server = await completionServer();
  try {
    let fieldReads = 0;
    let resolverCalls = 0;
    const credentialResolver: ProviderCredentialResolver = {
      resolve: () => {
        resolverCalls += 1;
        let reads = 0;
        return Promise.resolve({
          type: 'api-key',
          get apiKey() {
            fieldReads += 1;
            reads += 1;
            return reads === 1 ? 'snapshot-key' : '';
          },
        });
      },
    };
    const profile = createPiProviderRuntime({
      provider: provider(server.baseUrl),
      credentialResolver,
    });
    expect((await profile.checkReadiness()).status).toBe('ready');
    expect(fieldReads).toBe(1);
    expect(server.requests).toHaveLength(0);
    const actor = requireCompletionCapability(
      createActor({ id: 'actor', engine: profile.actorEngine })
    );
    await actor.complete({
      instructions: '',
      messages: [],
      maxOutputCharacters: 100,
      signal: new AbortController().signal,
    });
    expect(resolverCalls).toBe(2);
    expect(fieldReads).toBe(2);
    expect(server.authorizationHeaders).toEqual(['Bearer snapshot-key']);
  } finally {
    await server.close();
  }
});

it.each(['', 'x'.repeat(65537)])(
  'rejects an invalid first credential value without rereading it',
  async (first) => {
    let reads = 0;
    const profile = createPiProviderRuntime({
      provider: provider(),
      credentialResolver: {
        resolve: () =>
          Promise.resolve({
            type: 'api-key',
            get apiKey() {
              reads += 1;
              return reads === 1 ? first : 'later-valid';
            },
          }),
      },
    });
    await expect(profile.checkReadiness()).rejects.toMatchObject({
      code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED',
    });
    expect(reads).toBe(1);
  }
);

it('retains unavailable, resolver-failure and cancellation classifications', async () => {
  const unavailable = createPiProviderRuntime({
    provider: provider(),
    credentialResolver: { resolve: () => Promise.resolve(undefined) },
  });
  expect((await unavailable.checkReadiness()).status).toBe('credential-unavailable');
  const failure = new Error('resolver failed');
  const failed = createPiProviderRuntime({
    provider: provider(),
    credentialResolver: { resolve: () => Promise.reject(failure) },
  });
  await expect(failed.checkReadiness()).rejects.toMatchObject({
    code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED',
    cause: failure,
  });
  const controller = new AbortController();
  controller.abort();
  await expect(unavailable.checkReadiness({ signal: controller.signal })).rejects.toMatchObject({
    code: 'MODEL_INVOCATION_CANCELLED',
  });
});

it.each([null, 42, {}, { type: 'api-key' }, { type: 'api-key', apiKey: 42 }])(
  'rejects malformed untyped resolver output: %j',
  async (credential) => {
    const profile: unknown = Reflect.apply(createPiProviderRuntime, undefined, [
      { provider: provider(), credentialResolver: { resolve: () => Promise.resolve(credential) } },
    ]);
    if (
      typeof profile !== 'object' ||
      profile === null ||
      !('checkReadiness' in profile) ||
      typeof profile.checkReadiness !== 'function'
    )
      throw new Error('Expected a provider profile');
    const work: unknown = Reflect.apply(profile.checkReadiness, profile, []);
    await expect(work).rejects.toMatchObject({ code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED' });
  }
);
