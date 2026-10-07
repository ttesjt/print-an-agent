import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAgentBaseWebPorts } from './agent-base/backend.js';
import { loadWebProviderRuntime } from './host.js';
import { createOfflineWebEngine } from './offline-engine.js';
import { startLocalAgentWebServer } from './transport/http-server.js';

async function main() {
  const args = process.argv.slice(2);
  const fields = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined ||
      !['--port', '--root', '--provider'].includes(name) ||
      value === undefined ||
      fields.has(name)
    )
      throw new Error('Invalid host arguments.');
    fields.set(name, value);
  }
  const port = Number(fields.get('--port') ?? '4174');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const filename = fields.get('--provider');
  const engine =
    filename === undefined
      ? createOfflineWebEngine()
      : (await loadWebProviderRuntime(filename)).actorEngine;
  const ports = createAgentBaseWebPorts({
    engine,
    persistence: {
      kind: 'directory',
      rootDirectory: resolve(fields.get('--root') ?? 'temp/agent-web'),
    },
  });
  const host = await startLocalAgentWebServer({
    ports,
    port,
    publicDirectory: fileURLToPath(new URL('../../public/', import.meta.url)),
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });
  console.info(
    `Agent Web: ${host.origin} (${filename === undefined ? 'explicit offline Engine' : 'host-configured provider'})`
  );
  const shutdown = () => {
    void host.close().catch(() => {
      console.error('Local host shutdown failed.');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
void main().catch(() => {
  console.error('Agent Web host could not start. Check arguments and server-only configuration.');
  process.exitCode = 1;
});
