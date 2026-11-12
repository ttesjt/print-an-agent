import { bootstrapTestAgent } from '../support/owned-setup.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentAPI } from '@print-an-agent/base-composition';
import { describe, expect, it } from 'vitest';
import {
  createSharedSqliteStandaloneManagementService,
  createSharedSqliteStandaloneSessionNavigationService,
  createSharedSqliteStandaloneRuntimeService,
  createSharedSqliteStandaloneSessionService,
} from '../../src/index.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../support/resource-profile.js';

describe('authoritative Standalone bootstrap', () => {
  it('opens raw Memory Agents with independent scopes and explicit optional facades', async () => {
    const bootstrap = {
      schemaVersion: 1,
      identity: { id: 'bootstrap' },
      ...resourceProfileConfig(),
      persistence: { kind: 'memory' },
    };
    const options = resourceProfileRuntimeOptions(() => undefined);
    const first = await bootstrapTestAgent(bootstrap, options);
    const second = await bootstrapTestAgent(bootstrap, options);
    expect(first).not.toHaveProperty('agent');
    expect(first.resources.session).not.toBe(second.resources.session);
    expect(first.resources.requestJournal).not.toBe(second.resources.requestJournal);
    const response = await createAgentAPI(first).run({ message: 'bootstrap' });
    await expect(
      first.resources.session.inspect({
        agentId: first.identity.id,
        sessionId: response.sessionId,
      })
    ).resolves.toBeDefined();
    await expect(
      second.resources.session.inspect({
        agentId: second.identity.id,
        sessionId: response.sessionId,
      })
    ).resolves.toBeUndefined();
  });

  it('creates SQLite authority once, opens by location, and changes Config only through CAS', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-bootstrap-authority-'));
    const databasePath = join(directory, 'agent.sqlite');
    const options = {
      ...resourceProfileRuntimeOptions(() => undefined),
      sqlite: {
        tablePrefix: 'bootstrap_',
        tableNames: {
          identity: { identities: 'product_identities' },
          config: { configs: 'product_configs' },
          managedNamespace: { namespaces: 'product_namespaces' },
        },
      },
    };
    const bootstrap = {
      schemaVersion: 1,
      identity: { id: 'bootstrap' },
      ...resourceProfileConfig('Original.'),
      persistence: { kind: 'sqlite', databasePath },
    };
    try {
      const first = await bootstrapTestAgent(bootstrap, options);
      const response = await first.invoke('foreground', { message: 'preserve history' });
      const management = createSharedSqliteStandaloneManagementService({
        databasePath,
        sqlite: options.sqlite,
      });
      const runtimes = createSharedSqliteStandaloneRuntimeService({ ...options, databasePath });
      const sessions = createSharedSqliteStandaloneSessionService({
        databasePath,
        sqlite: options.sqlite,
      });
      const navigation = createSharedSqliteStandaloneSessionNavigationService({
        databasePath,
        sqlite: options.sqlite,
      });
      await expect(
        bootstrapTestAgent({ ...bootstrap, ...resourceProfileConfig('Replacement.') }, options)
      ).rejects.toMatchObject({ code: 'MANAGED_AGENT_ALREADY_EXISTS' });
      expect((await management.inspect('bootstrap')).config).toMatchObject({
        revision: 1,
        value: { mainActor: { instructions: 'Original.' } },
      });
      await expect(
        navigation.inspect({
          agentId: 'bootstrap',
          sessionId: response.sessionId,
        })
      ).resolves.toMatchObject({ status: 'inspected' });
      const reopened = await runtimes.open('bootstrap');
      expect(reopened).not.toBe(first);
      expect(
        (await sessions.listTurns({ agentId: 'bootstrap', sessionId: response.sessionId }))?.records
      ).toHaveLength(1);
      await management.updateConfig({
        agentId: 'bootstrap',
        expectedRevision: 1,
        config: { ...resourceProfileConfig('Updated.'), request: { timeoutMilliseconds: 123_456 } },
      });
      expect(
        (await runtimes.open('bootstrap')).operations.foreground.config.timeoutMilliseconds
      ).toBe(123_456);
      expect(first.operations.foreground.config.timeoutMilliseconds).toBeNull();
      await expect(
        management.importConfig({
          agentId: 'bootstrap',
          expectedRevision: 1,
          input: resourceProfileConfig(),
        })
      ).rejects.toMatchObject({ code: 'CONFIG_REVISION_CONFLICT' });
      await management.importConfig({
        agentId: 'bootstrap',
        expectedRevision: 2,
        input: resourceProfileConfig('Imported.'),
      });
      await management.disable({ agentId: 'bootstrap', expectedIdentityRevision: 1 });
      await expect(bootstrapTestAgent(bootstrap, options)).rejects.toMatchObject({
        code: 'MANAGED_AGENT_ALREADY_EXISTS',
      });
      await expect(runtimes.open('bootstrap')).rejects.toMatchObject({
        code: 'MANAGED_AGENT_DISABLED',
      });
      await expect(runtimes.open('missing')).rejects.toMatchObject({
        code: 'MANAGED_AGENT_NOT_FOUND',
      });
      expect((await management.inspect('bootstrap')).config.revision).toBe(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps published authority when subsequent runtime materialization fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-bootstrap-open-failure-'));
    const databasePath = join(directory, 'agent.sqlite');
    const options = resourceProfileRuntimeOptions(() => undefined);
    try {
      const invalidRuntimeConfig = {
        provider: {
          config: {
            kind: 'builtin' as const,
            reference: {
              provider: 'missing-provider',
              model: 'missing-model',
              credentialRef: 'credentials/missing',
            },
          },
          transportLivenessPolicy: {
            responseStartTimeoutMilliseconds: null,
            streamEventIdleTimeoutMilliseconds: null,
          },
        },
        credential: {
          reference: 'credentials/missing',
          environmentVariable: 'MISSING_API_KEY',
        },
        mainActor: { invocationPolicy: { timeoutMilliseconds: null } },
        request: { timeoutMilliseconds: null },
        sessionCompaction: { timeoutMilliseconds: null },
      };
      await expect(
        bootstrapTestAgent(
          {
            schemaVersion: 1,
            identity: { id: 'bootstrap' },
            ...invalidRuntimeConfig,
            persistence: { kind: 'sqlite', databasePath },
          },
          options
        )
      ).rejects.toMatchObject({ code: 'MANAGED_AGENT_OPERATION_FAILED' });
      const management = createSharedSqliteStandaloneManagementService({ databasePath });
      const snapshot = await management.inspect('bootstrap');
      expect(snapshot.config.revision).toBe(1);
      expect(snapshot.config.value).toMatchObject(invalidRuntimeConfig);
      await management.updateConfig({
        agentId: 'bootstrap',
        expectedRevision: 1,
        config: resourceProfileConfig(),
      });
      const recovered = await createSharedSqliteStandaloneRuntimeService({
        ...options,
        databasePath,
      }).open('bootstrap');
      expect(recovered.identity.id).toBe('bootstrap');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects invalid host runtime options before committing authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-bootstrap-preflight-'));
    const databasePath = join(directory, 'agent.sqlite');
    const bootstrap = {
      schemaVersion: 1,
      identity: { id: 'bootstrap' },
      ...resourceProfileConfig(),
      persistence: { kind: 'sqlite' as const, databasePath },
    };
    const options = resourceProfileRuntimeOptions(() => undefined);
    try {
      await expect(
        bootstrapTestAgent(bootstrap, {
          ...options,
          requestLimits: {
            maxMessageCharacters: 1000,
            maxInstructionsCharacters: 1000,
            maxOutputCharacters: 1000,
            maxReasoningCharacters: 1000,
            maxModelTurns: -1,
            maxPendingInteractionEvents: 10,
          },
        })
      ).rejects.toMatchObject({ code: 'STANDALONE_CONFIG_INVALID' });
      await expect(
        createSharedSqliteStandaloneManagementService({ databasePath }).inspect('bootstrap')
      ).rejects.toMatchObject({ code: 'MANAGED_AGENT_NOT_FOUND' });
      await expect(bootstrapTestAgent(bootstrap, options)).resolves.toMatchObject({
        identity: { id: 'bootstrap' },
      });
      expect(
        (await createSharedSqliteStandaloneManagementService({ databasePath }).inspect('bootstrap'))
          .config.revision
      ).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
