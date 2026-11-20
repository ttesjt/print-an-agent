import type { ResolveAgentConfigOptions, WriteAgentConfigOptions } from './types/options.js';
import type { ResolvedAgentConfig } from './types/snapshot.js';
import { AgentConfigError } from './errors.js';
import { encodeAndValidate, validateSchemaVersion } from './codec.js';
import { decodeConfigSnapshot } from './snapshot.js';

export async function resolveAgentConfig<TConfig>(
  options: ResolveAgentConfigOptions<TConfig>
): Promise<ResolvedAgentConfig<TConfig>> {
  validateSchemaVersion(options.codec.schemaVersion);
  const snapshot = await options.adapter.read(options.identity.id);
  if (snapshot !== undefined) {
    return Object.freeze({
      identity: options.identity,
      config: decodeConfigSnapshot(options, snapshot),
      source: 'stored',
      revision: snapshot.revision,
    });
  }

  if (options.createDefault === undefined) {
    throw new AgentConfigError(
      'CONFIG_NOT_FOUND',
      `No stored or default config exists for agent "${options.identity.id}".`
    );
  }

  const validated = encodeAndValidate(options.codec, options.createDefault());
  return Object.freeze({
    identity: options.identity,
    config: validated.config,
    source: 'default',
    revision: null,
  });
}

export async function writeAgentConfig<TConfig>(
  options: WriteAgentConfigOptions<TConfig>
): Promise<ResolvedAgentConfig<TConfig>> {
  validateSchemaVersion(options.codec.schemaVersion);
  const validated = encodeAndValidate(options.codec, options.config);
  const snapshot = await options.adapter.write({
    agentId: options.identity.id,
    schemaVersion: options.codec.schemaVersion,
    value: validated.value,
    expectedRevision: options.expectedRevision,
  });

  return Object.freeze({
    identity: options.identity,
    config: decodeConfigSnapshot(options, snapshot),
    source: 'stored',
    revision: snapshot.revision,
  });
}
