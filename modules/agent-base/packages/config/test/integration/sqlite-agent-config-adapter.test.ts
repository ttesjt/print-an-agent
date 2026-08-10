import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  resolveAgentConfig,
  SqliteAgentConfigAdapter,
  writeAgentConfig,
  type AgentConfigCodec,
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

function createTemporaryDatabase(): Readonly<{
  databasePath: string;
  dispose(): void;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-config-'));
  return Object.freeze({
    databasePath: join(directory, 'agent.sqlite'),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  });
}

describe('SqliteAgentConfigAdapter', () => {
  it('creates, updates, and reopens isolated config revisions', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const bro = defineAgentIdentity({ id: 'bro' });
      const mochi = defineAgentIdentity({ id: 'mochi' });
      const first = new SqliteAgentConfigAdapter({ databasePath: temporary.databasePath });
      await writeAgentConfig({
        identity: bro,
        codec: TEST_CODEC,
        adapter: first,
        config: { enabled: true, tone: 'warm' },
        expectedRevision: null,
      });
      await writeAgentConfig({
        identity: mochi,
        codec: TEST_CODEC,
        adapter: first,
        config: { enabled: false, tone: 'quiet' },
        expectedRevision: null,
      });
      await writeAgentConfig({
        identity: bro,
        codec: TEST_CODEC,
        adapter: first,
        config: { enabled: false, tone: 'focused' },
        expectedRevision: 1,
      });

      const reopened = new SqliteAgentConfigAdapter({ databasePath: temporary.databasePath });
      await expect(
        resolveAgentConfig({ identity: bro, codec: TEST_CODEC, adapter: reopened })
      ).resolves.toMatchObject({ config: { tone: 'focused' }, revision: 2 });
      await expect(
        resolveAgentConfig({ identity: mochi, codec: TEST_CODEC, adapter: reopened })
      ).resolves.toMatchObject({ config: { tone: 'quiet' }, revision: 1 });
    } finally {
      temporary.dispose();
    }
  });

  it('rejects stale CAS writes and retains the winning value', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'bro' });
      const adapter = new SqliteAgentConfigAdapter({ databasePath: temporary.databasePath });
      await writeAgentConfig({
        identity,
        codec: TEST_CODEC,
        adapter,
        config: { enabled: true, tone: 'winning' },
        expectedRevision: null,
      });
      await expect(
        writeAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter,
          config: { enabled: false, tone: 'stale' },
          expectedRevision: null,
        })
      ).rejects.toMatchObject({ code: 'CONFIG_REVISION_CONFLICT' });
      await expect(
        resolveAgentConfig({ identity, codec: TEST_CODEC, adapter })
      ).resolves.toMatchObject({ config: { tone: 'winning' }, revision: 1 });
    } finally {
      temporary.dispose();
    }
  });

  it('fails closed for corrupt values and unsupported storage schemas', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'bro' });
      const adapter = new SqliteAgentConfigAdapter({ databasePath: temporary.databasePath });
      await writeAgentConfig({
        identity,
        codec: TEST_CODEC,
        adapter,
        config: { enabled: true, tone: 'warm' },
        expectedRevision: null,
      });
      const database = new DatabaseSync(temporary.databasePath);
      database
        .prepare('UPDATE ta_agent_base_configs SET value_json = ? WHERE agent_id = ?')
        .run('{broken', identity.id);
      database.close();
      await expect(adapter.read(identity.id)).rejects.toMatchObject({
        code: 'CONFIG_ADAPTER_RESULT_INVALID',
      });

      const schemaDatabase = new DatabaseSync(temporary.databasePath);
      schemaDatabase
        .prepare('UPDATE ta_agent_base_config_schema SET version = 2 WHERE component = ?')
        .run('@ta-agent/base-config');
      schemaDatabase.close();
      let received: unknown;
      try {
        new SqliteAgentConfigAdapter({ databasePath: temporary.databasePath });
      } catch (error: unknown) {
        received = error;
      }
      expect(received).toMatchObject({ code: 'CONFIG_STORAGE_SCHEMA_UNSUPPORTED' });
    } finally {
      temporary.dispose();
    }
  });

  it('enforces an explicit encoded-value size budget', async () => {
    const temporary = createTemporaryDatabase();
    try {
      const identity = defineAgentIdentity({ id: 'bro' });
      const adapter = new SqliteAgentConfigAdapter({
        databasePath: temporary.databasePath,
        maxValueBytes: 32,
      });
      await expect(
        writeAgentConfig({
          identity,
          codec: TEST_CODEC,
          adapter,
          config: { enabled: true, tone: 'this value is intentionally too large' },
          expectedRevision: null,
        })
      ).rejects.toMatchObject({ code: 'CONFIG_SIZE_LIMIT_EXCEEDED' });
    } finally {
      temporary.dispose();
    }
  });
});
