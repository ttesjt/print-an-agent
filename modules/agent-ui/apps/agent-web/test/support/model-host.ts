// Keep server-side provider fetch out of the browser DOM environment, just like production.
import { resolve } from 'node:path';
import type * as Backend from '../../src/node/agent-base/backend.js';
import type * as Server from '../../src/node/transport/http-server.js';

const backend: unknown = await import(
  resolve(import.meta.dirname, '../../dist/server/node/agent-base/backend.js')
);
const server: unknown = await import(
  resolve(import.meta.dirname, '../../dist/server/node/transport/http-server.js')
);
function isBackend(value: unknown): value is Pick<typeof Backend, 'createAgentBaseWebPorts'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createAgentBaseWebPorts' in value &&
    typeof value.createAgentBaseWebPorts === 'function'
  );
}
function isServer(value: unknown): value is Pick<typeof Server, 'startLocalAgentWebServer'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'startLocalAgentWebServer' in value &&
    typeof value.startLocalAgentWebServer === 'function'
  );
}
if (!isBackend(backend) || !isServer(server))
  throw new Error('Build the application before qualification');

const ports = backend.createAgentBaseWebPorts({
  persistence: { kind: 'memory' },
  readEnvironmentVariable: (name) => process.env[name],
});
const host = await server.startLocalAgentWebServer({ ports });
process.send?.({ origin: host.origin });
process.once('message', () => {
  void host.close().then(() => process.disconnect());
});
