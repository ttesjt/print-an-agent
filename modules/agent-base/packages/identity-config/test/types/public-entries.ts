import {
  defineAgentIdentity,
  type AgentId as RootAgentId,
  type AgentConfigCodec as RootCodec,
} from '@print-an-agent/base-identity-config';
import {
  parseAgentId,
  type AgentId as IdentityAgentId,
} from '@print-an-agent/base-identity-config/identity';
import {
  resolveAgentConfig,
  type AgentConfigCodec,
  type ResolvedAgentConfig,
} from '@print-an-agent/base-identity-config/config';

interface Settings {
  readonly enabled: boolean;
}
const codec: AgentConfigCodec<Settings> = {
  schemaVersion: 1,
  decode(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('enabled' in value) ||
      typeof value.enabled !== 'boolean'
    )
      throw new TypeError('Invalid settings.');
    return { enabled: value.enabled };
  },
  encode: (value) => ({ enabled: value.enabled }),
};
const rootCodec: RootCodec<Settings> = codec;
const rootId: RootAgentId = parseAgentId('typed-agent');
const featureId: IdentityAgentId = rootId;
const roundTripId: RootAgentId = featureId;
void rootCodec;
void roundTripId;

export function checkPublicTypes(): void {
  const result: Promise<ResolvedAgentConfig<Settings>> = resolveAgentConfig({
    identity: defineAgentIdentity({ id: featureId }),
    codec,
    adapter: { read: () => Promise.resolve(undefined) },
    createDefault: () => ({ enabled: true }),
  });
  void result;
  // @ts-expect-error AgentId remains branded, even through the aggregate entry.
  const invalidId: RootAgentId = 'unvalidated';
  void invalidId;
  void resolveAgentConfig({
    identity: defineAgentIdentity({ id: featureId }),
    codec,
    adapter: { read: () => Promise.resolve(undefined) },
    // @ts-expect-error Codec inference retains Settings rather than erasing config values.
    createDefault: () => ({ enabled: 'wrong' }),
  });
}
