import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStandaloneAgent } from '@ta-agent/base-standalone-agent';
import { AgentBaseCliError } from './errors.js';
import type { AgentBaseCliRuntime } from './contracts.js';

const MAX_CONFIG_BYTES = 65_536;

async function readConfig(configPath: string): Promise<unknown> {
  const absolutePath = resolve(configPath);
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

export async function loadAgentBaseCliRuntime(
  configPath: string,
  environment: NodeJS.ProcessEnv
): Promise<AgentBaseCliRuntime> {
  const config = await readConfig(configPath);
  const agent = createStandaloneAgent(config, {
    readEnvironmentVariable: (name) => environment[name],
  });
  const runtime: AgentBaseCliRuntime = {
    checkProvider: (signal) => agent.checkProviderReadiness({ signal }),
    run: async (input, options) =>
      agent.run(
        {
          ...input,
          outputSink: {
            open: () => Promise.resolve(),
            write: (event) => options.writeTextDelta(event.delta),
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
