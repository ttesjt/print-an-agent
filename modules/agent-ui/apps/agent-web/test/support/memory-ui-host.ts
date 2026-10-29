import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { onTestFinished } from 'vitest';
import { connectHttpMemory } from '../../src/memory/browser.js';
import { createHttpAgentWebPorts } from '../../src/adapters/http-agent-web-ports.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';
import { domEnvironment } from './dom-environment.js';
import type { WebMemoryOptions } from '../../src/node/memory/options.js';
export async function memoryUiHost(options?: WebMemoryOptions) {
  const child = fork(resolve(import.meta.dirname, 'memory-host-process.ts'), [], {
    env: {
      ...process.env,
      MEMORY_CONTEXT_ONLY:
        options?.provisioning.retrieval === undefined && options !== undefined ? '1' : '0',
      MEMORY_MULTI: options?.contextBindings ? '1' : '0',
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  onTestFinished(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.send('close');
    await exited;
  });
  const startup = new AbortController();
  const timer = setTimeout(() => startup.abort(), 10000);
  let events: unknown;
  try {
    events = await once(child, 'message', { signal: startup.signal });
  } finally {
    clearTimeout(timer);
  }
  const message: unknown = Array.isArray(events) ? events[0] : undefined;
  if (
    typeof message !== 'object' ||
    message === null ||
    !('origin' in message) ||
    typeof message.origin !== 'string'
  )
    throw new Error('Host did not start');
  domEnvironment().setURL(message.origin);
  const baseUrl = message.origin + '/api';
  const backend = createHttpAgentWebPorts({ baseUrl });
  const result = await backend.agents.createAgent({
    identity: { agentId: 'a', displayName: 'Agent A' },
    config: DEFAULT_AGENT_CONFIG,
  });
  if (result.status !== 'succeeded') throw new Error('Agent fixture failed');
  return { backend, memory: await connectHttpMemory({ baseUrl }) };
}
