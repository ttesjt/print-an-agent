import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createStandaloneAgent,
  createStandaloneAgentDirectory,
  type ManagedStandaloneAgentSnapshot,
  type StandaloneAgent,
} from '@ta-agent/base-standalone-agent';
import { AgentBaseCliError } from './errors.js';
import type {
  AgentBaseCliManagedDirectory,
  AgentBaseCliRuntime,
  AgentBaseCliRuntimeLocator,
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

function projectRuntime(agent: StandaloneAgent): AgentBaseCliRuntime {
  const runtime: AgentBaseCliRuntime = {
    checkProvider: (signal) => agent.checkProviderReadiness({ signal }),
    run: async (input, options) =>
      agent.run(
        {
          ...input,
          outputSink: {
            open: () => Promise.resolve(),
            write: (event) =>
              event.type === 'text-delta' ? options.writeTextDelta(event.delta) : Promise.resolve(),
            close: () => Promise.resolve(),
            fail: () => Promise.resolve(),
          },
        },
        { signal: options.signal }
      ),
    compactSession: (input, signal) => agent.compactSession(input, { signal }),
    inspectSession: (sessionId, signal) =>
      agent.navigateSession({ sessionId, operation: 'inspect' }, { signal }),
    selectSessionBranch: (input, signal) =>
      agent.navigateSession({ ...input, operation: 'select' }, { signal }),
    forkSessionBranch: (input, signal) =>
      agent.navigateSession({ ...input, operation: 'fork' }, { signal }),
    rewindSession: (input, signal) =>
      agent.navigateSession({ ...input, operation: 'rewind' }, { signal }),
  };
  return Object.freeze(runtime);
}

function safeManagedSnapshot(snapshot: ManagedStandaloneAgentSnapshot): Readonly<{
  agentId: string;
  displayName: string;
  status: ManagedStandaloneAgentSnapshot['identity']['status'];
  identityRevision: number;
  configRevision: number;
  manifestProjection: ManagedStandaloneAgentSnapshot['manifestProjection'];
}> {
  return Object.freeze({
    agentId: snapshot.identity.identity.id,
    displayName: snapshot.identity.identity.displayName,
    status: snapshot.identity.status,
    identityRevision: snapshot.identity.revision,
    configRevision: snapshot.configRevision,
    manifestProjection: snapshot.manifestProjection,
  });
}

export function loadAgentBaseCliManagedDirectory(
  rootDirectory: string,
  environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliManagedDirectory> {
  const directory = createStandaloneAgentDirectory({
    rootDirectory,
    readEnvironmentVariable: (name) => environment[name],
  });
  return Promise.resolve(
    Object.freeze({
      create: async (manifest: unknown) => safeManagedSnapshot(await directory.create(manifest)),
      list: async () => (await directory.list()).map(safeManagedSnapshot),
      inspect: async (agentId: string) => safeManagedSnapshot(await directory.inspect(agentId)),
      disable: async (agentId: string, expectedRevision: number) =>
        safeManagedSnapshot(await directory.disable({ agentId, expectedRevision })),
      reactivate: async (agentId: string, expectedRevision: number) =>
        safeManagedSnapshot(await directory.reactivate({ agentId, expectedRevision })),
    })
  );
}

export async function loadAgentBaseCliRuntime(
  locator: AgentBaseCliRuntimeLocator,
  environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliRuntime> {
  if (locator.kind === 'config') {
    const config = await readAgentBaseCliJsonDocument(locator.configPath);
    return projectRuntime(
      createStandaloneAgent(config, {
        readEnvironmentVariable: (name) => environment[name],
      })
    );
  }
  const directory = createStandaloneAgentDirectory({
    rootDirectory: locator.rootDirectory,
    readEnvironmentVariable: (name) => environment[name],
  });
  return projectRuntime(await directory.open(locator.agentId));
}
