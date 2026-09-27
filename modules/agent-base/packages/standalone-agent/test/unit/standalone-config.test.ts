import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  createSharedSqliteStandaloneAgentRegistry,
  createStandaloneAgent,
  createStandaloneAgentDirectory,
  defineStandaloneAgentConfig,
  STANDALONE_AGENT_DEFINITION_CODEC,
} from '../../src/index.js';

function validConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    identity: { id: 'standalone-agent', displayName: 'Standalone Agent' },
    provider: {
      config: {
        kind: 'openai-compatible',
        reference: {
          provider: 'loopback',
          model: 'test-model',
          baseUrl: 'http://127.0.0.1:8080/v1',
          credentialRef: 'credentials/standalone',
        },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false },
      },
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 10_000,
        streamEventIdleTimeoutMilliseconds: 20_000,
      },
    },
    credential: {
      reference: 'credentials/standalone',
      environmentVariable: 'TA_AGENT_TEST_API_KEY',
    },
    persistence: { kind: 'memory' },
    mainActor: {
      instructions: 'Answer directly.',
      invocationConfig: { temperature: 0, maxOutputTokens: 256 },
      invocationPolicy: { timeoutMilliseconds: 30_000 },
    },
    request: { timeoutMilliseconds: 40_000 },
    sessionCompaction: { timeoutMilliseconds: 50_000 },
  };
}

function expectStandaloneConfigInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error('Expected Standalone configuration to fail.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentBaseStandaloneError);
    if (!(error instanceof AgentBaseStandaloneError)) return;
    expect(error.code).toBe('STANDALONE_CONFIG_INVALID');
  }
}

describe('standalone Agent Base configuration', () => {
  it('normalizes and freezes the closed versioned configuration', () => {
    const config = defineStandaloneAgentConfig(validConfig());

    expect(config).toMatchObject({
      schemaVersion: 1,
      identity: { id: 'standalone-agent', displayName: 'Standalone Agent' },
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: { baseUrl: 'http://127.0.0.1:8080/v1' },
          supportsReasoning: true,
          compatibility: { supportsDeveloperRole: false },
        },
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: 10_000,
          streamEventIdleTimeoutMilliseconds: 20_000,
        },
      },
      credential: { environmentVariable: 'TA_AGENT_TEST_API_KEY' },
      persistence: { kind: 'memory' },
      mainActor: {
        invocationConfig: { temperature: 0, maxOutputTokens: 256 },
        invocationPolicy: { timeoutMilliseconds: 30_000 },
      },
      request: { timeoutMilliseconds: 40_000 },
      sessionCompaction: { timeoutMilliseconds: 50_000 },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.identity)).toBe(true);
    expect(Object.isFrozen(config.persistence)).toBe(true);
    expect(Object.isFrozen(config.provider)).toBe(true);
    expect(Object.isFrozen(config.provider.transportLivenessPolicy)).toBe(true);
    expect(Object.isFrozen(config.mainActor)).toBe(true);
    expect(Object.isFrozen(config.mainActor.invocationPolicy)).toBe(true);
    expect(Object.isFrozen(config.request)).toBe(true);
    expect(Object.isFrozen(config.sessionCompaction)).toBe(true);
    expect(config.provider.config.kind).toBe('openai-compatible');
    if (config.provider.config.kind === 'openai-compatible') {
      expect(Object.isFrozen(config.provider.config.compatibility)).toBe(true);
    }
  });

  it('defaults every durable timeout boundary to no automatic timeout and encodes it explicitly', () => {
    const input = validConfig();
    const provider = input.provider as Record<string, unknown>;
    const mainActor = input.mainActor as Record<string, unknown>;
    delete provider.transportLivenessPolicy;
    delete mainActor.invocationPolicy;
    delete input.request;
    delete input.sessionCompaction;

    const config = defineStandaloneAgentConfig(input);
    expect(config.provider.transportLivenessPolicy).toEqual({
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: null,
    });
    expect(config.mainActor.invocationPolicy).toEqual({ timeoutMilliseconds: null });
    expect(config.request).toEqual({ timeoutMilliseconds: null });
    expect(config.sessionCompaction).toEqual({ timeoutMilliseconds: null });

    const encoded = STANDALONE_AGENT_DEFINITION_CODEC.encode({
      provider: config.provider,
      ...(config.credential === undefined ? {} : { credential: config.credential }),
      mainActor: config.mainActor,
      request: config.request,
      sessionCompaction: config.sessionCompaction,
    });
    expect(encoded).toMatchObject({
      provider: {
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: null,
          streamEventIdleTimeoutMilliseconds: null,
        },
      },
      mainActor: { invocationPolicy: { timeoutMilliseconds: null } },
      request: { timeoutMilliseconds: null },
      sessionCompaction: { timeoutMilliseconds: null },
    });
  });

  it('rejects invalid timeout values at every durable Standalone boundary', () => {
    const invalidValues: readonly unknown[] = [0, -1, 1.5, 2_147_483_648, Infinity, '30000'];
    const applyInvalidValue = [
      (input: Record<string, unknown>, value: unknown) => {
        input.request = { timeoutMilliseconds: value };
      },
      (input: Record<string, unknown>, value: unknown) => {
        input.sessionCompaction = { timeoutMilliseconds: value };
      },
      (input: Record<string, unknown>, value: unknown) => {
        const mainActor = input.mainActor as Record<string, unknown>;
        mainActor.invocationPolicy = { timeoutMilliseconds: value };
      },
      (input: Record<string, unknown>, value: unknown) => {
        const provider = input.provider as Record<string, unknown>;
        provider.transportLivenessPolicy = {
          responseStartTimeoutMilliseconds: value,
          streamEventIdleTimeoutMilliseconds: null,
        };
      },
    ] as const;

    for (const value of invalidValues) {
      for (const apply of applyInvalidValue) {
        const input = validConfig();
        apply(input, value);
        expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(input));
      }
    }
  });

  it('rejects unknown fields and accessors in durable timeout sections', () => {
    const unknown = validConfig();
    unknown.request = { timeoutMilliseconds: null, mode: 'soft' };
    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(unknown));

    const accessor = validConfig();
    const request = {};
    Object.defineProperty(request, 'timeoutMilliseconds', {
      enumerable: true,
      get: () => null,
    });
    accessor.request = request;
    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(accessor));
  });

  it('uses durable configuration as the only Standalone timeout authority', () => {
    const config = validConfig();
    const requestLimits = {
      maxMessageCharacters: 1_000,
      maxInstructionsCharacters: 2_000,
      maxOutputCharacters: 3_000,
      maxReasoningCharacters: 4_000,
      maxModelTurns: 5,
      maxPendingInteractionEvents: 6,
    };
    const agent = createStandaloneAgent(config, {
      readEnvironmentVariable: () => undefined,
      requestLimits,
    });

    expect(agent.agent.operations.foreground.config).toMatchObject({
      maxMessageCharacters: 1_000,
      timeoutMilliseconds: 40_000,
    });
    expect(agent.agent.operations.compactSession.config.timeoutMilliseconds).toBe(50_000);
    expect(agent.inspectProvider().transportLivenessPolicy).toEqual({
      responseStartTimeoutMilliseconds: 10_000,
      streamEventIdleTimeoutMilliseconds: 20_000,
    });

    const legacyOptions = {
      readEnvironmentVariable: () => undefined,
      requestPolicy: { timeoutMilliseconds: 1 },
    };
    const directoryOptions = {
      ...legacyOptions,
      rootDirectory: '/tmp/standalone-timeout-authority',
    };
    const sharedOptions = {
      ...legacyOptions,
      databasePath: '/tmp/standalone-timeout-authority.sqlite',
    };
    expectStandaloneConfigInvalid(() => createStandaloneAgent(config, legacyOptions));
    expectStandaloneConfigInvalid(() => createStandaloneAgentDirectory(directoryOptions));
    expectStandaloneConfigInvalid(() => createSharedSqliteStandaloneAgentRegistry(sharedOptions));

    const limitsWithTimeout = { ...requestLimits, timeoutMilliseconds: 1 };
    expectStandaloneConfigInvalid(() =>
      createStandaloneAgent(config, {
        readEnvironmentVariable: () => undefined,
        requestLimits: limitsWithTimeout,
      })
    );
  });

  it('requires explicit OpenAI-compatible instruction-role compatibility', () => {
    const input = validConfig();
    const provider = (input.provider as Record<string, unknown>).config as Record<string, unknown>;
    delete provider.compatibility;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(input));
  });

  it('requires an explicit OpenAI-compatible reasoning capability declaration', () => {
    const input = validConfig();
    const provider = (input.provider as Record<string, unknown>).config as Record<string, unknown>;
    delete provider.supportsReasoning;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(input));
  });

  it.each([false, true])(
    'preserves developer-role compatibility through the managed Config codec when set to %s',
    (supportsDeveloperRole) => {
      const input = validConfig();
      const provider = (input.provider as Record<string, unknown>).config as Record<
        string,
        unknown
      >;
      provider.compatibility = { supportsDeveloperRole };
      const definition = {
        provider: input.provider,
        credential: input.credential,
        mainActor: input.mainActor,
        request: input.request,
        sessionCompaction: input.sessionCompaction,
      };

      const canonical = STANDALONE_AGENT_DEFINITION_CODEC.decode(definition);
      const encoded = STANDALONE_AGENT_DEFINITION_CODEC.encode(canonical);
      expect(encoded).toMatchObject({
        provider: {
          config: { compatibility: { supportsDeveloperRole } },
          transportLivenessPolicy: {
            responseStartTimeoutMilliseconds: 10_000,
            streamEventIdleTimeoutMilliseconds: 20_000,
          },
        },
        mainActor: { invocationPolicy: { timeoutMilliseconds: 30_000 } },
        request: { timeoutMilliseconds: 40_000 },
        sessionCompaction: { timeoutMilliseconds: 50_000 },
      });
      expect(STANDALONE_AGENT_DEFINITION_CODEC.decode(encoded)).toMatchObject({
        provider: {
          config: { compatibility: { supportsDeveloperRole } },
          transportLivenessPolicy: {
            responseStartTimeoutMilliseconds: 10_000,
            streamEventIdleTimeoutMilliseconds: 20_000,
          },
        },
        mainActor: { invocationPolicy: { timeoutMilliseconds: 30_000 } },
        request: { timeoutMilliseconds: 40_000 },
        sessionCompaction: { timeoutMilliseconds: 50_000 },
      });
    }
  );

  it('rejects the obsolete flat Standalone provider shape instead of dual-reading it', () => {
    const input = validConfig();
    input.provider = (input.provider as Record<string, unknown>).config;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(input));
  });

  it.each([
    [{ ...validConfig(), unsupported: true }, 'unsupported field'],
    [
      {
        ...validConfig(),
        provider: {
          config: {
            kind: 'openai-compatible',
            reference: {
              provider: 'loopback',
              model: 'test-model',
              baseUrl: 'http://127.0.0.1:8080/v1',
              unsupported: true,
            },
            contextWindowTokens: 8_192,
            maxOutputTokens: 1_024,
            supportsReasoning: true,
            compatibility: { supportsDeveloperRole: false },
          },
        },
      },
      'invalid',
    ],
    [
      {
        ...validConfig(),
        credential: {
          reference: 'credentials/wrong',
          environmentVariable: 'TA_AGENT_TEST_API_KEY',
        },
      },
      'match',
    ],
    [
      { ...validConfig(), persistence: { kind: 'sqlite', databasePath: 'relative.sqlite' } },
      'absolute path',
    ],
    [
      {
        ...validConfig(),
        persistence: {
          kind: 'sqlite',
          databasePath: '/tmp/agent.sqlite',
          tablePrefix: 'product_',
        },
      },
      'unsupported field',
    ],
  ])('rejects invalid standalone input without widening the schema', (input, message) => {
    try {
      defineStandaloneAgentConfig(input);
      throw new Error('Expected standalone configuration validation to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentBaseStandaloneError);
      if (!(error instanceof AgentBaseStandaloneError)) return;
      expect(error.code).toBe('STANDALONE_CONFIG_INVALID');
      expect(error.message).toContain(String(message));
    }
  });

  it('constructs memory and explicit SQLite profiles through the same public bootstrap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-agent-'));
    const environment = { TA_AGENT_TEST_API_KEY: 'PRIVATE_TEST_KEY' };
    try {
      const memoryAgent = createStandaloneAgent(validConfig(), {
        readEnvironmentVariable: (name) => environment[name as keyof typeof environment],
      });
      const sqliteAgent = createStandaloneAgent(
        {
          ...validConfig(),
          persistence: {
            kind: 'sqlite',
            databasePath: join(directory, 'agent.sqlite'),
          },
        },
        {
          readEnvironmentVariable: () => undefined,
          sqlite: {
            tablePrefix: 'runtime_',
            tableNames: {
              session: { sessions: 'conversations' },
              requestJournal: { entries: 'request_receipts' },
            },
          },
        }
      );

      await expect(memoryAgent.checkProviderReadiness()).resolves.toMatchObject({
        status: 'ready',
      });
      await expect(sqliteAgent.checkProviderReadiness()).resolves.toMatchObject({
        status: 'credential-unavailable',
      });
      expect(memoryAgent.identity.id).toBe('standalone-agent');
      expect(sqliteAgent.identity.id).toBe('standalone-agent');

      const database = new DatabaseSync(join(directory, 'agent.sqlite'));
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      database.close();
      expect(tables).toEqual([
        'conversations',
        'request_receipts',
        'runtime_request_journal_schema',
        'runtime_session_branches',
        'runtime_session_compactions',
        'runtime_session_schema',
        'runtime_session_turns',
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects SQLite naming options for Memory persistence and cross-domain collisions', () => {
    expectStandaloneConfigInvalid(() =>
      createStandaloneAgent(validConfig(), {
        readEnvironmentVariable: () => undefined,
        sqlite: { tablePrefix: 'unused_' },
      })
    );

    expectStandaloneConfigInvalid(() =>
      createStandaloneAgent(
        {
          ...validConfig(),
          persistence: { kind: 'sqlite', databasePath: '/tmp/collision-agent.sqlite' },
        },
        {
          readEnvironmentVariable: () => undefined,
          sqlite: {
            tableNames: {
              session: { sessions: 'shared_records' },
              requestJournal: { entries: 'SHARED_RECORDS' },
            },
          },
        }
      )
    );
  });
});
