import { describe, expect, it } from 'vitest';
import {
  resolveAgentConfig,
  writeAgentConfig,
  type AgentConfigCodec,
  type AgentConfigError,
  type AgentConfigReadAdapter,
  type AgentConfigSnapshot,
  type ConfigValue,
} from '@print-an-agent/base-config';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import { MemoryAgentConfigAdapter } from '../../src/index.js';

interface TestConfig {
  readonly enabled: boolean;
  readonly tone: string;
}

const TEST_CODEC: AgentConfigCodec<TestConfig> = {
  schemaVersion: 1,
  decode(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Config must be an object.');
    }

    const record = value as Record<string, unknown>;
    if (typeof record.enabled !== 'boolean' || typeof record.tone !== 'string') {
      throw new TypeError('Config fields are invalid.');
    }

    return Object.freeze({ enabled: record.enabled, tone: record.tone });
  },
  encode(config): ConfigValue {
    return { enabled: config.enabled, tone: config.tone };
  },
};

function expectConfigError(
  run: () => Promise<unknown>,
  code: AgentConfigError['code']
): Promise<void> {
  return run().then(
    () => {
      throw new Error(`Expected AgentConfigError with code ${code}.`);
    },
    (error: unknown) => {
      expect(error).toMatchObject({ code });
    }
  );
}

describe('Agent config', () => {
  it('resolves a validated default without silently persisting it', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const adapter = new MemoryAgentConfigAdapter();

    await expect(
      resolveAgentConfig({
        identity,
        codec: TEST_CODEC,
        adapter,
        createDefault: () => ({ enabled: true, tone: 'warm' }),
      })
    ).resolves.toEqual({
      identity,
      config: { enabled: true, tone: 'warm' },
      source: 'default',
      revision: null,
    });
    await expect(adapter.read(identity.id)).resolves.toBeUndefined();
  });

  it('creates, reads, and replaces a stored config with explicit CAS revisions', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const adapter = new MemoryAgentConfigAdapter();

    const created = await writeAgentConfig({
      identity,
      codec: TEST_CODEC,
      adapter,
      config: { enabled: true, tone: 'warm' },
      expectedRevision: null,
    });
    expect(created.revision).toBe(1);

    await expect(resolveAgentConfig({ identity, codec: TEST_CODEC, adapter })).resolves.toEqual({
      identity,
      config: { enabled: true, tone: 'warm' },
      source: 'stored',
      revision: 1,
    });

    const replaced = await writeAgentConfig({
      identity,
      codec: TEST_CODEC,
      adapter,
      config: { enabled: false, tone: 'quiet' },
      expectedRevision: 1,
    });
    expect(replaced).toMatchObject({
      config: { enabled: false, tone: 'quiet' },
      source: 'stored',
      revision: 2,
    });
  });

  it('fails a stale config write instead of overwriting newer data', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const adapter = new MemoryAgentConfigAdapter();
    await writeAgentConfig({
      identity,
      codec: TEST_CODEC,
      adapter,
      config: { enabled: true, tone: 'warm' },
      expectedRevision: null,
    });

    await expectConfigError(
      () =>
        writeAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter,
          config: { enabled: false, tone: 'quiet' },
          expectedRevision: null,
        }),
      'CONFIG_REVISION_CONFLICT'
    );
  });

  it('fails when neither stored nor default config exists', async () => {
    const identity = defineAgentIdentity({ id: 'missing' });

    await expectConfigError(
      () =>
        resolveAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter: new MemoryAgentConfigAdapter(),
        }),
      'CONFIG_NOT_FOUND'
    );
  });

  it('rejects adapter data for another identity or schema version', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const otherIdentity = defineAgentIdentity({ id: 'mochi' });

    const mismatchedIdentityAdapter: AgentConfigReadAdapter = {
      read: () =>
        Promise.resolve<AgentConfigSnapshot>({
          agentId: otherIdentity.id,
          schemaVersion: 1,
          revision: 1,
          value: { enabled: true, tone: 'warm' },
        }),
    };
    await expectConfigError(
      () => resolveAgentConfig({ identity, codec: TEST_CODEC, adapter: mismatchedIdentityAdapter }),
      'CONFIG_SNAPSHOT_IDENTITY_MISMATCH'
    );

    const unsupportedSchemaAdapter: AgentConfigReadAdapter = {
      read: () =>
        Promise.resolve<AgentConfigSnapshot>({
          agentId: identity.id,
          schemaVersion: 2,
          revision: 1,
          value: { enabled: true, tone: 'warm' },
        }),
    };
    await expectConfigError(
      () => resolveAgentConfig({ identity, codec: TEST_CODEC, adapter: unsupportedSchemaAdapter }),
      'CONFIG_SCHEMA_VERSION_UNSUPPORTED'
    );
  });

  it('validates defaults and stored documents through the same codec', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const adapter = new MemoryAgentConfigAdapter();

    await expectConfigError(
      () =>
        resolveAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter,
          createDefault: () => ({ enabled: true, tone: 42 }) as unknown as TestConfig,
        }),
      'CONFIG_INVALID'
    );
  });

  it.each([
    ['non-finite number', { enabled: true, tone: Number.NaN }],
    ['non-JSON value', { enabled: true, tone: undefined }],
  ])('rejects %s returned by a lying codec', async (_label, invalidValue) => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const codec: AgentConfigCodec<TestConfig> = {
      schemaVersion: 1,
      decode: (value) => TEST_CODEC.decode(value),
      encode: () => invalidValue as unknown as ConfigValue,
    };

    await expectConfigError(
      () =>
        writeAgentConfig({
          identity,
          codec,
          adapter: new MemoryAgentConfigAdapter(),
          config: { enabled: true, tone: 'warm' },
          expectedRevision: null,
        }),
      'CONFIG_INVALID'
    );
  });

  it('rejects cyclic and excessively nested config values', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let nested: unknown = 'leaf';
    for (let index = 0; index < 66; index += 1) nested = [nested];

    for (const invalidValue of [cyclic, nested]) {
      const codec: AgentConfigCodec<TestConfig> = {
        schemaVersion: 1,
        decode: (value) => TEST_CODEC.decode(value),
        encode: () => invalidValue as ConfigValue,
      };
      await expectConfigError(
        () =>
          writeAgentConfig({
            identity,
            codec,
            adapter: new MemoryAgentConfigAdapter(),
            config: { enabled: true, tone: 'warm' },
            expectedRevision: null,
          }),
        'CONFIG_INVALID'
      );
    }
  });

  it('isolates documents by Agent ID and clones values at the adapter boundary', async () => {
    const bro = defineAgentIdentity({ id: 'bro' });
    const mochi = defineAgentIdentity({ id: 'mochi' });
    const adapter = new MemoryAgentConfigAdapter();

    await writeAgentConfig({
      identity: bro,
      codec: TEST_CODEC,
      adapter,
      config: { enabled: true, tone: 'warm' },
      expectedRevision: null,
    });
    await writeAgentConfig({
      identity: mochi,
      codec: TEST_CODEC,
      adapter,
      config: { enabled: false, tone: 'quiet' },
      expectedRevision: null,
    });

    const broSnapshot = await adapter.read(bro.id);
    if (broSnapshot === undefined) throw new Error('Expected Bro config snapshot.');
    const mutableValue = broSnapshot.value as { tone: string };
    expect(() => {
      mutableValue.tone = 'mutated outside adapter';
    }).toThrow(TypeError);

    await expect(
      resolveAgentConfig({ identity: bro, codec: TEST_CODEC, adapter })
    ).resolves.toMatchObject({
      config: { tone: 'warm' },
    });
    await expect(
      resolveAgentConfig({ identity: mochi, codec: TEST_CODEC, adapter })
    ).resolves.toMatchObject({
      config: { tone: 'quiet' },
    });
  });
});
