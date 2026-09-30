import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createStandaloneAgent,
  createStandaloneDirectoryManagementService,
  createStandaloneDirectoryRuntimeService,
  createStandaloneDirectorySessionService,
  createStandaloneProviderService,
  defineStandaloneAgentBootstrapConfig,
  defineStandaloneAgentManifest,
  type StandaloneAgentManagementService,
  type StandaloneRawAgent,
  type StandaloneSessionManagementService,
} from '@ta-agent/base-standalone-agent';
import { AgentBaseCliError } from './errors.js';
import type {
  AgentBaseCliManagedDirectory,
  AgentBaseCliProvider,
  AgentBaseCliRuntime,
  AgentBaseCliRuntimeLocator,
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

function projectRuntime(agent: StandaloneRawAgent): AgentBaseCliRuntime {
  const runtime: AgentBaseCliRuntime = {
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
    inspectSession: (sessionId, signal) =>
      agent.invoke('navigateSession', { sessionId, operation: 'inspect' }, { signal }),
    selectSessionBranch: (input, signal) =>
      agent.invoke('navigateSession', { ...input, operation: 'select' }, { signal }),
    forkSessionBranch: (input, signal) =>
      agent.invoke('navigateSession', { ...input, operation: 'fork' }, { signal }),
    rewindSession: (input, signal) =>
      agent.invoke('navigateSession', { ...input, operation: 'rewind' }, { signal }),
  };
  return Object.freeze(runtime);
}

function projectProvider(
  provider: ReturnType<typeof createStandaloneProviderService>
): AgentBaseCliProvider {
  return Object.freeze({
    check: (signal: AbortSignal) => provider.checkReadiness({ signal }),
  });
}

function safeManagedSnapshot(snapshot: ManagedSnapshot): Readonly<{
  agentId: string;
  displayName: string;
  status: ManagedSnapshot['identity']['status'];
  identityRevision: number;
  configRevision: number;
  manifestProjection: ManagedSnapshot['projection']['kind'];
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

export function loadAgentBaseCliManagedDirectory(
  rootDirectory: string,
  _environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliManagedDirectory> {
  const management = createStandaloneDirectoryManagementService({
    rootDirectory,
  });
  return Promise.resolve(
    Object.freeze({
      create: async (input: unknown) => {
        const manifest = defineStandaloneAgentManifest(input);
        return safeManagedSnapshot(
          await management.create({ identity: manifest.identity, config: manifest.config })
        );
      },
      list: async () => (await management.list()).map(safeManagedSnapshot),
      inspect: async (agentId: string) => safeManagedSnapshot(await management.inspect(agentId)),
      disable: async (agentId: string, expectedRevision: number) =>
        safeManagedSnapshot(
          await management.disable({ agentId, expectedIdentityRevision: expectedRevision })
        ),
      reactivate: async (agentId: string, expectedRevision: number) =>
        safeManagedSnapshot(
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
    const config = await readAgentBaseCliJsonDocument(locator.configPath);
    const api = createStandaloneAgent(config, {
      readEnvironmentVariable: (name) => environment[name],
    });
    return projectRuntime(api.agent);
  }
  const runtime = createStandaloneDirectoryRuntimeService({
    rootDirectory: locator.rootDirectory,
    readEnvironmentVariable: (name) => environment[name],
  });
  return projectRuntime(await runtime.open(locator.agentId));
}

export async function loadAgentBaseCliProvider(
  locator: AgentBaseCliRuntimeLocator,
  environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliProvider> {
  const config =
    locator.kind === 'config'
      ? defineStandaloneAgentBootstrapConfig(await readAgentBaseCliJsonDocument(locator.configPath))
      : (
          await createStandaloneDirectoryManagementService({
            rootDirectory: locator.rootDirectory,
          }).inspect(locator.agentId)
        ).config.value;
  return projectProvider(
    createStandaloneProviderService(config, {
      readEnvironmentVariable: (name) => environment[name],
    })
  );
}
