import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreparedRelease } from './packages.ts';

/** Read-only fixture serving the prepared tarballs through the npm metadata protocol. */
export async function startPackageRegistry(release: PreparedRelease, directory: string) {
  const requests = new Set<string>();
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const artifact = release.packages.find((pkg) => pathname === `/tarballs/${pkg.filename}`);
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (artifact !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(readFileSync(join(directory, artifact.filename)));
      return;
    }
    const pkg = release.packages.find((pkg) => pathname === `/${pkg.name}`);
    if (pkg === undefined) {
      response.writeHead(404).end();
      return;
    }
    requests.add(pkg.name);
    const manifest = {
      ...pkg.manifest,
      dist: { tarball: `${url}/tarballs/${pkg.filename}`, integrity: pkg.integrity },
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        name: pkg.name,
        'dist-tags': { latest: release.version },
        versions: { [release.version]: manifest },
      })
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing registry address.');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
