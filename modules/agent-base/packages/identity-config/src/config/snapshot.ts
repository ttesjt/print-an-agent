import type { AgentIdentity } from '../identity/index.js';
import type { AgentConfigCodec } from './types/codec.js';
import type { AgentConfigSnapshot } from './types/snapshot.js';
import { AgentConfigError } from './errors.js';
import { decodeConfig } from './codec.js';
import { normalizeConfigValue } from './value.js';

export function decodeConfigSnapshot<TConfig>(
  options: Readonly<{ identity: AgentIdentity; codec: AgentConfigCodec<TConfig> }>,
  snapshot: AgentConfigSnapshot
): TConfig {
  if (snapshot.agentId !== options.identity.id) {
    throw new AgentConfigError(
      'CONFIG_SNAPSHOT_IDENTITY_MISMATCH',
      `Config adapter returned data for "${snapshot.agentId}" while resolving "${options.identity.id}".`
    );
  }
  if (snapshot.schemaVersion !== options.codec.schemaVersion) {
    throw new AgentConfigError(
      'CONFIG_SCHEMA_VERSION_UNSUPPORTED',
      `Config schema version ${snapshot.schemaVersion} is not supported by codec version ${options.codec.schemaVersion}.`
    );
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      'Config adapter returned an invalid revision.'
    );
  }

  return decodeConfig(options.codec, normalizeConfigValue(snapshot.value));
}
