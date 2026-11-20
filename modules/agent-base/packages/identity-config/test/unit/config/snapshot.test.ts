import { describe, expect, it } from 'vitest';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  resolveAgentConfig,
  writeAgentConfig,
  type AgentConfigSnapshot,
} from '@print-an-agent/base-identity-config/config';
import { codec, identity, settings, stored } from '../../fixtures/config.js';

const invalidSnapshots = [
  {
    snapshot: { ...stored, agentId: defineAgentIdentity({ id: 'other' }).id },
    code: 'CONFIG_SNAPSHOT_IDENTITY_MISMATCH',
  },
  { snapshot: { ...stored, schemaVersion: 2 }, code: 'CONFIG_SCHEMA_VERSION_UNSUPPORTED' },
  { snapshot: { ...stored, revision: 0 }, code: 'CONFIG_ADAPTER_RESULT_INVALID' },
  { snapshot: { ...stored, value: { enabled: Number.NaN } }, code: 'CONFIG_INVALID' },
];

function operations(snapshot: AgentConfigSnapshot) {
  const adapter = { read: () => Promise.resolve(snapshot), write: () => Promise.resolve(snapshot) };
  return {
    resolve: () => resolveAgentConfig({ identity, codec, adapter }),
    write: () =>
      writeAgentConfig({ identity, codec, adapter, config: settings, expectedRevision: 2 }),
  };
}

describe('Config adapter snapshots', () => {
  it.each(invalidSnapshots)(
    'rejects invalid snapshots in both operation paths: $code',
    async ({ snapshot, code }) => {
      for (const operation of Object.values(operations(snapshot))) {
        await expect(operation()).rejects.toMatchObject({ code });
      }
    }
  );

  it('uses the adapter result as stored authority without resolving a default', async () => {
    const snapshot = { ...stored, value: { enabled: false } };
    for (const operation of Object.values(operations(snapshot))) {
      const result = await operation();
      expect(result).toEqual({
        identity,
        config: { enabled: false },
        source: 'stored',
        revision: 3,
      });
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});
