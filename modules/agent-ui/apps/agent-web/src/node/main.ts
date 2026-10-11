import { fileURLToPath } from 'node:url';
import { createDirectoryCollectionHost } from './collections/directory-host.js';
import { startLocalAgentWebServer } from './transport/http-server.js';
import { parseHostArguments } from './host-arguments.js';

async function main() {
  const { port, initialRoot } = parseHostArguments(process.argv.slice(2));
  const collections = await createDirectoryCollectionHost({
    readEnvironmentVariable: (name) => process.env[name],
    ...(initialRoot === undefined ? {} : { initialRoot }),
  });
  const host = await startLocalAgentWebServer({
    collections,
    port,
    publicDirectory: fileURLToPath(new URL('../../public/', import.meta.url)),
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });
  console.info(`Agent Web: ${host.origin} (per-Agent model configuration)`);
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
