import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createStandaloneAgent,
  createStandaloneMemorySetup,
  createStandaloneDirectoryManagementService,
  createStandaloneDirectoryRuntimeService,
  createStandaloneDirectorySessionNavigationService,
  createStandaloneDirectorySessionService,
  createSharedSqliteStandaloneManagementService,
  createSharedSqliteStandaloneSessionNavigationService,
  createSharedSqliteStandaloneRuntimeService,
  createStandaloneProviderService,
  defineStandaloneAgentBootstrapConfig,
  defineStandaloneAgentManifest,
  type StandaloneAgentManagementService,
  type StandaloneRawAgent,
  type StandaloneSessionNavigationService,
  type StandaloneSessionManagementService,
} from '@ta-agent/base-standalone-agent';
import { AgentBaseCliError } from './errors.js';
import type {
  AgentBaseCliAgentManager,
  AgentBaseCliProvider,
  AgentBaseCliRuntime,
  AgentBaseCliRuntimeLocator,
  AgentBaseCliManagedAgentLocator,
  AgentBaseCliSessionNavigator,
  AgentBaseCliStorageLocator,
  AgentBaseCliSessionManager,
} from './contracts.js';

const MAX_CONFIG_BYTES = 65_536;

export async function readAgentBaseCliJsonDocument(documentPath: string): Promise<unknown> {
  const absolutePath = resolve(documentPath);
  try {
    const metadata = await stat(absolutePath);
    if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) {
      throw new AgentBaseCliError(
        'CLI_CONFIG_INVALID',
        'Configuration must be a regular JSON file no larger than 64 KiB.'
      );
    }
    return JSON.parse(await readFile(absolutePath, 'utf8')) as unknown;
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseCliError) throw cause;
    throw new AgentBaseCliError('CLI_CONFIG_INVALID', 'Configuration could not be loaded.', {
      cause,
    });
  }
}

type ManagedSnapshot = Awaited<ReturnType<StandaloneAgentManagementService['inspect']>>;
type ManagedCommitResult = Awaited<ReturnType<StandaloneAgentManagementService['create']>>;
type ManagedSummarySource = Readonly<{
  identity: ManagedSnapshot['identity'];
  config: ManagedSnapshot['config'];
  projection: ManagedSnapshot['projection'] | ManagedCommitResult['projection'];
}>;

function projectRuntime(
  agent: StandaloneRawAgent,
  close?: () => Promise<void>
): AgentBaseCliRuntime {
  const runtime: AgentBaseCliRuntime = {
    ...(close === undefined ? {} : { close }),
    run: async (input, options) =>
      agent.invoke(
        'foreground',
        {
          ...input,
          outputSink: {
            open: (event) => options.sessionOpened(event.sessionId),
            write: (event) =>
              event.type === 'text-delta' ? options.writeTextDelta(event.delta) : Promise.resolve(),
            close: () => Promise.resolve(),
            fail: () => Promise.resolve(),
          },
        },
        { signal: options.signal }
      ),
    compactSession: (input, signal) => agent.invoke('compactSession', input, { signal }),
  };
  return Object.freeze(runtime);
}

function projectSessionNavigator(
  service: StandaloneSessionNavigationService,
  agentId: string
): AgentBaseCliSessionNavigator {
  const navigator: AgentBaseCliSessionNavigator = {
    inspectSession: (sessionId, signal) => service.inspect({ agentId, sessionId }, { signal }),
    selectSessionBranch: (input, signal) => service.select({ ...input, agentId }, { signal }),
    forkSessionBranch: (input, signal) => service.fork({ ...input, agentId }, { signal }),
    rewindSession: (input, signal) => service.rewind({ ...input, agentId }, { signal }),
  };
  return Object.freeze(navigator);
}

function projectProvider(
  provider: ReturnType<typeof createStandaloneProviderService>
): AgentBaseCliProvider {
  return Object.freeze({
    check: (signal: AbortSignal) => provider.checkReadiness({ signal }),
  });
}

function safeManagedSnapshot(snapshot: ManagedSummarySource): Readonly<{
  agentId: string;
  displayName: string;
  status: ManagedSnapshot['identity']['status'];
  identityRevision: number;
  configRevision: number;
  manifestProjection: ManagedSummarySource['projection']['kind'];
}> {
  return Object.freeze({
    agentId: snapshot.identity.identity.id,
    displayName: snapshot.identity.identity.displayName,
    status: snapshot.identity.status,
    identityRevision: snapshot.identity.revision,
    configRevision: snapshot.config.revision,
    manifestProjection: snapshot.projection.kind,
  });
}

function safeManagedCommit(result: ManagedCommitResult) {
  return safeManagedSnapshot({
    ...result.authority,
    projection: result.projection,
  });
}

export function loadAgentBaseCliAgentManager(
  locator: AgentBaseCliStorageLocator
): Promise<AgentBaseCliAgentManager> {
  const management = createManagementService(locator);
  return Promise.resolve(
    Object.freeze({
      create: async (input: unknown) => {
        const manifest = defineStandaloneAgentManifest(input);
        return safeManagedCommit(
          await management.create({ identity: manifest.identity, config: manifest.config })
        );
      },
      list: async () => (await management.list()).map(safeManagedSnapshot),
      inspect: async (agentId: string) => safeManagedSnapshot(await management.inspect(agentId)),
      disable: async (agentId: string, expectedRevision: number) =>
        safeManagedCommit(
          await management.disable({ agentId, expectedIdentityRevision: expectedRevision })
        ),
      reactivate: async (agentId: string, expectedRevision: number) =>
        safeManagedCommit(
          await management.reactivate({ agentId, expectedIdentityRevision: expectedRevision })
        ),
    })
  );
}

function projectSessionManager(
  service: StandaloneSessionManagementService,
  agentId: string
): AgentBaseCliSessionManager {
  const manager: AgentBaseCliSessionManager = {
    list: (input) => service.list({ ...input, agentId }),
    listRetired: (input) => service.listRetired({ ...input, agentId }),
    inspect: (sessionId) => service.inspect({ agentId, sessionId }),
    listTurns: (input) => service.listTurns({ ...input, agentId }),
    retire: (sessionId, expectedRevision) =>
      service.retire({ agentId, sessionId, expectedRevision }),
    restore: (sessionId, expectedRevision) =>
      service.restore({ agentId, sessionId, expectedRevision }),
    purge: (sessionId, expectedRevision) =>
      service.purge({
        agentId,
        sessionId,
        expectedRevision,
        confirmation: 'permanently-delete-session',
      }),
    recover: (sessionId, expectedExecutionRevision) =>
      service.recover({ agentId, sessionId, expectedExecutionRevision }),
  };
  return Object.freeze(manager);
}

export function loadAgentBaseCliSessionManager(
  rootDirectory: string,
  agentId: string
): Promise<AgentBaseCliSessionManager> {
  return Promise.resolve(
    projectSessionManager(createStandaloneDirectorySessionService({ rootDirectory }), agentId)
  );
}

export async function loadAgentBaseCliRuntime(
  locator: AgentBaseCliRuntimeLocator,
  environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliRuntime> {
  if (locator.kind === 'config') {
    const config = await readMemoryBootstrap(locator.configPath);
    const setup = createStandaloneMemorySetup({
      readEnvironmentVariable: (name) => environment[name],
    });
    try {
      const agent = await createStandaloneAgent(setup, {
        identity: config.identity,
        config: {
          provider: config.provider,
          ...(config.credential === undefined ? {} : { credential: config.credential }),
          mainActor: config.mainActor,
          request: config.request,
          sessionCompaction: config.sessionCompaction,
        },
      });
      return projectRuntime(agent, () => setup.close());
    } catch (primary) {
      try {
        await setup.close({ mode: 'abort' });
      } catch (cleanup) {
        throw new AgentBaseCliError(
          'CLI_RESOURCE_CLEANUP_FAILED',
          'CLI runtime creation cleanup could not be confirmed.',
          { cause: { operation: { ok: false, error: primary }, cleanup } }
        );
      }
      throw primary;
    }
  }
  const options = { readEnvironmentVariable: (name: string) => environment[name] };
  const runtime =
    locator.kind === 'directory'
      ? createStandaloneDirectoryRuntimeService({
          ...options,
          rootDirectory: locator.rootDirectory,
        })
      : createSharedSqliteStandaloneRuntimeService({
          ...options,
          databasePath: locator.databasePath,
        });
  return projectRuntime(await runtime.open(locator.agentId));
}

export function loadAgentBaseCliSessionNavigator(
  locator: AgentBaseCliManagedAgentLocator
): Promise<AgentBaseCliSessionNavigator> {
  const service =
    locator.kind === 'directory'
      ? createStandaloneDirectorySessionNavigationService({
          rootDirectory: locator.rootDirectory,
        })
      : createSharedSqliteStandaloneSessionNavigationService({
          databasePath: locator.databasePath,
        });
  return Promise.resolve(projectSessionNavigator(service, locator.agentId));
}

export async function loadAgentBaseCliProvider(
  locator: AgentBaseCliRuntimeLocator,
  environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliProvider> {
  const config =
    locator.kind === 'config'
      ? await readMemoryBootstrap(locator.configPath)
      : (await createManagementService(locator).inspect(locator.agentId)).config.value;
  return projectProvider(
    createStandaloneProviderService(config, {
      readEnvironmentVariable: (name) => environment[name],
    })
  );
}

function createManagementService(
  locator: AgentBaseCliStorageLocator
): StandaloneAgentManagementService {
  return locator.kind === 'directory'
    ? createStandaloneDirectoryManagementService({ rootDirectory: locator.rootDirectory })
    : createSharedSqliteStandaloneManagementService({ databasePath: locator.databasePath });
}

async function readMemoryBootstrap(configPath: string) {
  const config = defineStandaloneAgentBootstrapConfig(
    await readAgentBaseCliJsonDocument(configPath)
  );
  if (config.persistence.kind !== 'memory') {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      '--config requires Memory persistence. Create durable Agents from a manifest, then open by storage location and Agent ID.'
    );
  }
  return config;
}
