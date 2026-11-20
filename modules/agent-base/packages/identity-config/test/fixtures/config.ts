import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import type {
  AgentConfigCodec,
  AgentConfigSnapshot,
} from '@print-an-agent/base-identity-config/config';

export const identity = defineAgentIdentity({ id: 'bro' });
export const settings: Readonly<{ enabled: boolean }> = Object.freeze({ enabled: true });
export const codec: AgentConfigCodec<typeof settings> = {
  schemaVersion: 1,
  decode(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('enabled' in value) ||
      typeof value.enabled !== 'boolean'
    ) {
      throw new TypeError('Expected boolean enabled.');
    }
    return Object.freeze({ enabled: value.enabled });
  },
  encode: (config) => ({ enabled: config.enabled }),
};
export const stored: AgentConfigSnapshot = Object.freeze({
  agentId: identity.id,
  schemaVersion: 1,
  revision: 3,
  value: settings,
});
