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
