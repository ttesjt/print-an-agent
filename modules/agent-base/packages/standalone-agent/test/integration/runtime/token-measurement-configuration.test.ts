import { FOREGROUND_INTERACTION_RESPONSIBILITY_ID } from '@print-an-agent/base-actor';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { createMemorySessionPersistence } from '@print-an-agent/base-local-adapters';
import {
  createTokenCounter,
  requireActorTextTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import {
  resolveTextTokenCounterConfig,
  type TextTokenCounterConfigInput,
} from '@print-an-agent/model-invocation-token-counters';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  createSharedSqliteStandaloneDefinition,
  createStandaloneDirectoryDefinition,
  createStandaloneProviderService,
  defineStandaloneAgentConfig,
  defineStandaloneAgentManifest,
  materializeStandaloneAgentRuntime,
  STANDALONE_AGENT_CONFIG_CODEC,
} from '../../../src/index.js';
import { compactionServer } from '../../support/compaction-server.js';
import { createManagedProfileHarness } from '../../support/managed-profile-harness.js';
import { bootstrapTestAgent } from '../../support/owned-setup.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../../support/resource-profile.js';

function config(textTokenCounter?: TextTokenCounterConfigInput) {
  const base = resourceProfileConfig();
  return defineStandaloneAgentConfig({
    ...base,
    provider: { ...base.provider, ...(textTokenCounter === undefined ? {} : { textTokenCounter }) },
  });
}

it.each([
  { kind: 'tiktoken', encoding: 'cl100k_base' },
  { kind: 'tiktoken', encoding: 'o200k_base' },
  { kind: 'character-estimator' },
  { kind: 'reference', measurementRef: 'test:host' },
] as const)('preserves canonical counter declarations through encode/decode %j', (declaration) => {
  const normalized = config(declaration);
  const encoded = STANDALONE_AGENT_CONFIG_CODEC.encode(normalized);
  expect(STANDALONE_AGENT_CONFIG_CODEC.decode(encoded)).toEqual(normalized);
  expect(JSON.stringify(encoded)).toContain('textTokenCounter');
  expect(Object.isFrozen(normalized.provider.textTokenCounter)).toBe(true);
});

it('has no implicit counter and rejects unknown, executable or ambiguous declaration fields', () => {
  expect(config().provider.textTokenCounter).toBeUndefined();
  const base = resourceProfileConfig();
  for (const textTokenCounter of [
    null,
    { kind: 'auto' },
    { kind: 'reference', measurementRef: 'not a ref' },
    { kind: 'tiktoken', encoding: 'cl100k_base', factory: () => undefined },
  ])
    expect(() =>
      defineStandaloneAgentConfig({ ...base, provider: { ...base.provider, textTokenCounter } })
    ).toThrow();
  expect(
    createStandaloneProviderService(
      config(),
      resourceProfileRuntimeOptions(() => undefined)
    ).inspect().textTokenCounter
  ).toBeUndefined();
});

it('materializes an exact model-bound counter without provider I/O, including direct bootstrap', async () => {
  const configuration = config({ kind: 'tiktoken', encoding: 'cl100k_base' });
  const options = resourceProfileRuntimeOptions(() => undefined);
  const agent = await bootstrapTestAgent(
    {
      schemaVersion: 1,
      identity: { id: 'counting' },
      ...configuration,
      persistence: { kind: 'memory' },
    },
    options
  );
  const consumer = await agent.resources.responsibilities.resolve(
    FOREGROUND_INTERACTION_RESPONSIBILITY_ID
  );
  const counter = requireActorTextTokenCounter(consumer.actor);
  expect(
    await counter.measure({ kind: 'text', text: 'hello world' }, new AbortController().signal)
  ).toMatchObject({ tokens: 2, accuracy: 'exact', scope: 'text' });
  const inspection = createStandaloneProviderService(configuration, options).inspect();
  expect(inspection.textTokenCounter).toEqual(counter.descriptor);
  expect(Object.isFrozen(inspection.textTokenCounter)).toBe(true);
});

it('uses only an explicit preloaded host reference and refuses missing/mismatched bindings', () => {
  const host = createTokenCounter({
    measurementRef: 'test:host',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
  });
  const configuration = config({ kind: 'reference', measurementRef: 'test:host' });
  const options = {
    ...resourceProfileRuntimeOptions(() => undefined),
    resolveTextTokenCounter: () => host,
  };
  expect(
    createStandaloneProviderService(configuration, options).inspect().textTokenCounter
  ).toEqual(host.descriptor);
  expect(() =>
    createStandaloneProviderService(
      configuration,
      resourceProfileRuntimeOptions(() => undefined)
    )
  ).toThrow();
  expect(() =>
    createStandaloneProviderService(
      config({ kind: 'reference', measurementRef: 'test:other' }),
      options
    )
  ).toThrow();
  expect(() =>
    materializeStandaloneAgentRuntime({
      identity: defineAgentIdentity({ id: 'missing' }),
      config: configuration,
      ports: createMemorySessionPersistence(),
      options: resourceProfileRuntimeOptions(() => undefined),
    })
  ).toThrow();
});

it.each(['directory', 'sqlite'] as const)(
  'reopens %s configuration with identical counting identity, and changes it only with Config',
  async (profile) => {
    const root = await mkdtemp(join(tmpdir(), 'measurement-config-'));
    const options = resourceProfileRuntimeOptions(() => undefined);
    const makeProfile = () =>
      profile === 'directory'
        ? createManagedProfileHarness(
            createStandaloneDirectoryDefinition({ ...options, rootDirectory: root })
          )
        : createManagedProfileHarness(
            createSharedSqliteStandaloneDefinition({
              ...options,
              databasePath: join(root, 'all.sqlite'),
            })
          );
    try {
      const initial = config({ kind: 'tiktoken', encoding: 'cl100k_base' });
      const first = makeProfile();
      await first.create({ schemaVersion: 1, identity: { id: 'agent' }, config: initial });
      const firstAgent = await first.open('agent');
      const before = requireActorTextTokenCounter(
        (
          await firstAgent.resources.responsibilities.resolve(
            FOREGROUND_INTERACTION_RESPONSIBILITY_ID
          )
        ).actor
      );
      const reopened = makeProfile();
      expect((await reopened.inspect('agent')).config.value.provider.textTokenCounter).toEqual(
        initial.provider.textTokenCounter
      );
      const secondAgent = await reopened.open('agent');
      const after = requireActorTextTokenCounter(
        (
          await secondAgent.resources.responsibilities.resolve(
            FOREGROUND_INTERACTION_RESPONSIBILITY_ID
          )
        ).actor
      );
      expect(after.descriptor).toEqual(before.descriptor);
      expect(
        (await after.measure({ kind: 'text', text: 'hello world' }, new AbortController().signal))
          .tokens
      ).toBe(2);
      if (profile === 'directory') {
        const manifest: unknown = JSON.parse(
          await readFile(join(root, 'agent', 'agent.json'), 'utf8')
        );
        expect(defineStandaloneAgentManifest(manifest).config.provider.textTokenCounter).toEqual(
          initial.provider.textTokenCounter
        );
      }
      const updated = config({ kind: 'tiktoken', encoding: 'o200k_base' });
      expect(JSON.stringify(STANDALONE_AGENT_CONFIG_CODEC.encode(updated))).not.toBe(
        JSON.stringify(STANDALONE_AGENT_CONFIG_CODEC.encode(initial))
      );
      await reopened.updateConfig({ agentId: 'agent', config: updated, expectedRevision: 1 });
      const nextAgent = await makeProfile().open('agent');
      const next = requireActorTextTokenCounter(
        (
          await nextAgent.resources.responsibilities.resolve(
            FOREGROUND_INTERACTION_RESPONSIBILITY_ID
          )
        ).actor
      );
      expect(next.descriptor.measurementRef).not.toBe(before.descriptor.measurementRef);
      expect(next.descriptor).toEqual(
        resolveTextTokenCounterConfig({ kind: 'tiktoken', encoding: 'o200k_base' }).descriptor
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it('compacts through declarative exact measurement, real Pi parsing, measured retry and Session publication', async () => {
  const server = await compactionServer(['one two three four five', 'short']);
  try {
    const base = resourceProfileConfig();
    const configuration = defineStandaloneAgentConfig({
      ...base,
      provider: {
        ...base.provider,
        config: {
          ...base.provider.config,
          reference: { ...base.provider.config.reference, baseUrl: server.baseUrl },
        },
        textTokenCounter: { kind: 'tiktoken', encoding: 'cl100k_base' },
      },
      sessionCompaction: {
        ...base.sessionCompaction,
        maxContextTokens: 2,
        target: { maxTokens: 2 },
      },
    });
    const agent = await bootstrapTestAgent(
      {
        schemaVersion: 1,
        identity: { id: 'compaction' },
        ...configuration,
        persistence: { kind: 'memory' },
      },
      resourceProfileRuntimeOptions(() => undefined)
    );
    const reference = await agent.resources.session.resolve({ agentId: agent.identity.id });
    for (let i = 0; i < 4; i++)
      await agent.invoke('foreground', { message: `fact-${i}`, sessionId: reference.sessionId });
    const result = await agent.invoke('compactSession', { sessionId: reference.sessionId });
    expect(result).toMatchObject({ status: 'compacted' });
    expect(server.requests).toHaveLength(2);
    expect((await agent.resources.session.readCompaction(reference))?.context.text).toBe('short');
  } finally {
    await server.close();
  }
});
