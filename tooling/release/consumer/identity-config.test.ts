import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as root from '@print-an-agent/base-identity-config';
import * as identity from '@print-an-agent/base-identity-config/identity';
import * as config from '@print-an-agent/base-identity-config/config';

interface Settings {
  readonly enabled: boolean;
}
const codec: config.AgentConfigCodec<Settings> = {
  schemaVersion: 1,
  decode(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('enabled' in value) ||
      typeof value.enabled !== 'boolean'
    )
      throw new TypeError('Invalid settings.');
    return Object.freeze({ enabled: value.enabled });
  },
  encode: (value) => ({ enabled: value.enabled }),
};
const sameCodec: root.AgentConfigCodec<Settings> = codec;
const rootId: root.AgentId = identity.parseAgentId('packed-agent');
const featureId: identity.AgentId = rootId;
const roundTripId: root.AgentId = featureId;
void sameCodec;
void roundTripId;

test('packed aggregate and feature entries share every runtime implementation', () => {
  assert.deepEqual(
    Object.keys(root).sort(),
    [...Object.keys(identity), ...Object.keys(config)].sort()
  );
  for (const [name, value] of [...Object.entries(identity), ...Object.entries(config)]) {
    assert.equal(Reflect.get(root, name), value, name);
  }
  assert.throws(() => identity.parseAgentId('Invalid Agent ID'), root.AgentIdentityError);
  assert.throws(() => root.normalizeConfigValue(Number.NaN), config.AgentConfigError);
});

test('packed Identity and Config retain independent revisions and default resolution', async () => {
  let identitySnapshot = identity.defineAgentIdentitySnapshot({
    identity: identity.defineAgentIdentity({ id: featureId }),
    status: 'active',
    revision: 7,
    createdAt: 1,
    updatedAt: 7,
  });
  let configSnapshot: config.AgentConfigSnapshot | undefined;
  let writes = 0;
  const adapter: config.AgentConfigWriteAdapter = {
    read: (id) => {
      assert.equal(id, featureId);
      return Promise.resolve(configSnapshot);
    },
    write(request) {
      if (request.expectedRevision !== (configSnapshot?.revision ?? null))
        return Promise.reject(
          new config.AgentConfigError('CONFIG_REVISION_CONFLICT', 'Stale config revision.')
        );
      writes++;
      configSnapshot = {
        agentId: request.agentId,
        schemaVersion: request.schemaVersion,
        revision: (configSnapshot?.revision ?? 0) + 1,
        value: request.value,
      };
      return Promise.resolve(configSnapshot);
    },
  };
  const catalog: identity.AgentIdentityCatalogPort = {
    read: () => Promise.resolve(identitySnapshot),
    list: () => Promise.resolve([identitySnapshot]),
    create: () => Promise.reject(new Error('Unexpected create.')),
    transition: () => Promise.reject(new Error('Unexpected transition.')),
    rename(request) {
      assert.equal(request.agentId, featureId);
      assert.equal(request.expectedRevision, identitySnapshot.revision);
      identitySnapshot = identity.defineAgentIdentitySnapshot({
        ...identitySnapshot,
        identity: identity.defineAgentIdentity({
          id: request.agentId,
          displayName: request.displayName,
        }),
        revision: identitySnapshot.revision + 1,
        updatedAt: identitySnapshot.updatedAt + 1,
      });
      return Promise.resolve(identitySnapshot);
    },
  };
  const defaults = await config.resolveAgentConfig({
    identity: identitySnapshot.identity,
    codec,
    adapter,
    createDefault: () => ({ enabled: false }),
  });
  assert.equal(defaults.source, 'default');
  assert.equal(defaults.revision, null);
  assert.equal(writes, 0);
  assert.equal(configSnapshot, undefined);

  const created = await root.writeAgentConfig({
    identity: identitySnapshot.identity,
    codec,
    adapter,
    config: { enabled: true },
    expectedRevision: null,
  });
  assert.equal(created.revision, 1);
  assert.equal(identitySnapshot.revision, 7);
  const renamed = await identity.renameAgentIdentity({
    agentId: featureId,
    displayName: 'Renamed',
    expectedRevision: 7,
    catalog,
  });
  assert.equal(renamed.revision, 8);
  assert.equal(renamed.identity.id, featureId);
  assert.equal((await adapter.read(featureId))?.revision, 1);

  const written = await config.writeAgentConfig({
    identity: renamed.identity,
    codec,
    adapter,
    config: { enabled: false },
    expectedRevision: 1,
  });
  assert.equal(written.revision, 2);
  assert.equal(identitySnapshot.revision, 8);
  const staleWrite = config.writeAgentConfig({
    identity: renamed.identity,
    codec,
    adapter,
    config: { enabled: true },
    expectedRevision: 1,
  });
  await assert.rejects(
    staleWrite,
    (error) => error instanceof root.AgentConfigError && error.code === 'CONFIG_REVISION_CONFLICT'
  );
  assert.equal(identitySnapshot.revision, 8);
  assert.equal(writes, 2);
});

test('packed package rejects private implementation paths', async () => {
  for (const specifier of [
    '@print-an-agent/base-identity-config/src/index.js',
    '@print-an-agent/base-identity-config/identity/types/identity',
    '@print-an-agent/base-identity-config/config/lib/config-value.js',
    '@print-an-agent/base-identity-config/identity/catalog/index.js',
    '@print-an-agent/base-identity-config/identity/values.js',
    '@print-an-agent/base-identity-config/config/value.js',
    '@print-an-agent/base-identity-config/config/types/codec.js',
    '@print-an-agent/base-identity-config/dist/identity/index.js',
  ])
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

function checkTypes(): void {
  // @ts-expect-error Branded AgentId is not an arbitrary string through either entry.
  const unvalidated: root.AgentId = 'unvalidated';
  void unvalidated;
  void config.resolveAgentConfig({
    identity: identity.defineAgentIdentity({ id: featureId }),
    codec,
    adapter: { read: () => Promise.resolve(undefined) },
    // @ts-expect-error Product codec inference preserves Settings.
    createDefault: () => ({ enabled: 'wrong' }),
  });
}
void checkTypes;
