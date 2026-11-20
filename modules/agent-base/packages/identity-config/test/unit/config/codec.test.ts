import { describe, expect, it, vi } from 'vitest';
import {
  AgentConfigError,
  resolveAgentConfig,
  writeAgentConfig,
} from '@print-an-agent/base-identity-config/config';
import { codec, identity, settings, stored } from '../../fixtures/config.js';

// Exercise the shared codec rules through both public operation paths.
describe('Config codec boundary', () => {
  it.each(['resolve', 'write'] as const)(
    'rejects an invalid schema before %s I/O',
    async (mode) => {
      const read = vi.fn(() => Promise.resolve(undefined));
      const write = vi.fn(() => Promise.resolve(stored));
      const options = { identity, codec: { ...codec, schemaVersion: 0 }, adapter: { read, write } };
      const result =
        mode === 'resolve'
          ? resolveAgentConfig({ ...options, createDefault: () => settings })
          : writeAgentConfig({ ...options, config: settings, expectedRevision: null });
      await expect(result).rejects.toMatchObject({ code: 'CONFIG_SCHEMA_VERSION_INVALID' });
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    }
  );

  it.each(['encode', 'decode'] as const)(
    'preserves the %s failure cause before writing',
    async (phase) => {
      const cause = new TypeError('codec failure');
      const failingCodec = {
        ...codec,
        [phase]: () => {
          throw cause;
        },
      };
      const write = vi.fn(() => Promise.resolve(stored));
      await expect(
        writeAgentConfig({
          identity,
          codec: failingCodec,
          config: settings,
          expectedRevision: null,
          adapter: { read: () => Promise.resolve(undefined), write },
        })
      ).rejects.toMatchObject({ name: 'AgentConfigError', code: 'CONFIG_INVALID', cause });
      expect(write).not.toHaveBeenCalled();
    }
  );

  it('validates defaults by round trip without writing even when the adapter can write', async () => {
    const value = { enabled: false };
    const decode = vi.fn((value: unknown) => codec.decode(value));
    const write = vi.fn(() => Promise.resolve(stored));
    const adapter = { read: () => Promise.resolve(undefined), write };
    const result = await resolveAgentConfig({
      identity,
      codec: { ...codec, encode: () => value, decode },
      adapter,
      createDefault: () => settings,
    });
    expect(result).toEqual({
      identity,
      config: { enabled: false },
      source: 'default',
      revision: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
    const encoded: unknown = decode.mock.calls[0]?.[0];
    expect(encoded).not.toBe(value);
    expect(Object.isFrozen(encoded)).toBe(true);
    expect(Object.isFrozen(value)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves stored decode diagnostics and adapter failure identity', async () => {
    const cause = new TypeError('cannot decode');
    await expect(
      resolveAgentConfig({
        identity,
        codec: {
          ...codec,
          decode: () => {
            throw cause;
          },
        },
        adapter: { read: () => Promise.resolve(stored) },
      })
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID', cause });
    const conflict = new AgentConfigError('CONFIG_REVISION_CONFLICT', 'stale revision');
    await expect(
      writeAgentConfig({
        identity,
        codec,
        config: settings,
        expectedRevision: 2,
        adapter: { read: () => Promise.resolve(stored), write: () => Promise.reject(conflict) },
      })
    ).rejects.toBe(conflict);
  });
});
