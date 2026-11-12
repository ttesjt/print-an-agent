import { defineAgentIdentity } from '@print-an-agent/base-identity';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentConfigError,
  resolveAgentConfig,
  writeAgentConfig,
  type AgentConfigCodec,
  type AgentConfigReadAdapter,
  type AgentConfigSnapshot,
  type AgentConfigWriteAdapter,
  type AgentConfigWriteRequest,
  type ConfigValue,
} from '../../src/index.js';

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

function readAdapter(snapshot?: AgentConfigSnapshot): AgentConfigReadAdapter {
  return Object.freeze({ read: () => Promise.resolve(snapshot) });
}

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

describe('Agent config lifecycle', () => {
  it('resolves a validated default without requiring write capability', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });

    await expect(
      resolveAgentConfig({
        identity,
        codec: TEST_CODEC,
        adapter: readAdapter(),
        createDefault: () => ({ enabled: true, tone: 'warm' }),
      })
    ).resolves.toEqual({
      identity,
      config: { enabled: true, tone: 'warm' },
      source: 'default',
      revision: null,
    });
  });

  it('validates adapter identity and schema ownership', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const otherIdentity = defineAgentIdentity({ id: 'mochi' });
    const value = Object.freeze({ enabled: true, tone: 'warm' });

    await expectConfigError(
      () =>
        resolveAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter: readAdapter({
            agentId: otherIdentity.id,
            schemaVersion: 1,
            revision: 1,
            value,
          }),
        }),
      'CONFIG_SNAPSHOT_IDENTITY_MISMATCH'
    );
    await expectConfigError(
      () =>
        resolveAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter: readAdapter({
            agentId: identity.id,
            schemaVersion: 2,
            revision: 1,
            value,
          }),
        }),
      'CONFIG_SCHEMA_VERSION_UNSUPPORTED'
    );
  });

  it('passes normalized values and revision authority to the write port', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const requests: AgentConfigWriteRequest[] = [];
    const adapter: AgentConfigWriteAdapter = Object.freeze({
      read: () => Promise.resolve(undefined),
      write(request: AgentConfigWriteRequest) {
        requests.push(request);
        return Promise.resolve(
          Object.freeze({
            agentId: request.agentId,
            schemaVersion: request.schemaVersion,
            revision: 4,
            value: request.value,
          })
        );
      },
    });

    await expect(
      writeAgentConfig({
        identity,
        codec: TEST_CODEC,
        adapter,
        config: { enabled: true, tone: 'warm' },
        expectedRevision: 3,
      })
    ).resolves.toEqual({
      identity,
      config: { enabled: true, tone: 'warm' },
      source: 'stored',
      revision: 4,
    });
    expect(requests).toEqual([
      {
        agentId: identity.id,
        schemaVersion: 1,
        value: { enabled: true, tone: 'warm' },
        expectedRevision: 3,
      },
    ]);
    expect(Object.isFrozen(requests[0]?.value)).toBe(true);
  });

  it('rejects invalid encoded values before calling the write port', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const write = vi.fn<AgentConfigWriteAdapter['write']>();
    const adapter: AgentConfigWriteAdapter = Object.freeze({
      read: () => Promise.resolve(undefined),
      write,
    });
    const invalidCodec: AgentConfigCodec<TestConfig> = {
      ...TEST_CODEC,
      encode: () => ({ enabled: true, tone: Number.NaN }),
    };

    await expectConfigError(
      () =>
        writeAgentConfig({
          identity,
          codec: invalidCodec,
          adapter,
          config: { enabled: true, tone: 'warm' },
          expectedRevision: null,
        }),
      'CONFIG_INVALID'
    );
    expect(write).not.toHaveBeenCalled();
  });
});
