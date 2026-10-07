import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { ServerResponse } from 'node:http';

const mime: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
export async function serveStatic(
  root: string,
  url: string,
  response: ServerResponse
): Promise<void> {
  const path = url.split('?')[0];
  if (
    path !== '/' &&
    path !== '/index.html' &&
    (path === undefined || !/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg)$/u.test(path))
  ) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const name = path === '/' ? 'index.html' : path?.slice(1);
    if (name === undefined) throw new Error('Missing path');
    const content = await readFile(join(root, name));
    response.writeHead(200, {
      'Content-Type': mime[extname(name)] ?? 'application/octet-stream',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end();
  }
}
