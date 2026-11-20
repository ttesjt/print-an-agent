import { expect, it } from 'vitest';
import * as root from '@print-an-agent/base-identity-config';
import * as identity from '@print-an-agent/base-identity-config/identity';
import * as config from '@print-an-agent/base-identity-config/config';

it('re-exports the same implementation from root and feature entries', () => {
  expect(Object.keys(root).sort()).toEqual(
    [...Object.keys(identity), ...Object.keys(config)].sort()
  );
  for (const [name, value] of [...Object.entries(identity), ...Object.entries(config)]) {
    expect(Reflect.get(root, name), name).toBe(value);
  }
});
it('keeps error-class identity across every public entry', () => {
  expect(() => identity.parseAgentId('Invalid Agent ID')).toThrow(root.AgentIdentityError);
  expect(() => root.normalizeConfigValue(Number.NaN)).toThrow(config.AgentConfigError);
  expect(new root.AgentIdentityError('AGENT_ID_INVALID', 'invalid')).toBeInstanceOf(
    identity.AgentIdentityError
  );
});

it('preserves Identity error diagnostics through the aggregate and feature entries', () => {
  const cause = new Error('catalog failed');
  const error = new root.AgentIdentityError('AGENT_IDENTITY_STORAGE_FAILED', 'cannot read', {
    cause,
  });
  expect(error).toBeInstanceOf(identity.AgentIdentityError);
  expect(error).toMatchObject({
    name: 'AgentIdentityError',
    code: 'AGENT_IDENTITY_STORAGE_FAILED',
    message: 'cannot read',
    cause,
  });
  expect(error.cause).toBe(cause);
});

it('preserves Config error diagnostics through the aggregate and feature entries', () => {
  const cause = new Error('storage failed');
  const error = new root.AgentConfigError('CONFIG_STORAGE_FAILED', 'cannot read', { cause });
  expect(error).toBeInstanceOf(config.AgentConfigError);
  expect(error).toMatchObject({
    name: 'AgentConfigError',
    code: 'CONFIG_STORAGE_FAILED',
    message: 'cannot read',
    cause,
  });
  expect(error.cause).toBe(cause);
});
