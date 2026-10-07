import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AgentWebPorts } from '../../application/ports.js';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { commandName, commands } from '../../transport/commands.js';
import { fail, object, text, TransportProtocolError } from '../../transport/decoder.js';
import { WEB_TRANSPORT_LIMITS } from '../../transport/limits.js';
import { interactionEvent, interactionInput } from '../../transport/schemas.js';
import { serveStatic } from './static.js';

export interface LocalServerOptions {
  readonly ports: AgentWebPorts<AgentWebConfig>;
  readonly port?: number;
  readonly publicDirectory?: string;
  /** Explicit trusted browser origins, for a same-machine Vite dev proxy. No wildcard CORS. */
  readonly allowedOrigins?: readonly string[];
}
const commandEnvelope = object({
  command: text(128, 1),
  input: { decode: (value: unknown) => value },
});

export async function startLocalAgentWebServer(options: LocalServerOptions) {
  const active = new Map<AbortController, Promise<void>>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let origin = '';
  const server = createServer((request, response) => {
    const controller = new AbortController();
    const work = handle(request, response, controller).finally(() => {
      active.delete(controller);
    });
    active.set(controller, work);
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  server.listen(options.port ?? 0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Local host has no TCP address.');
  origin = `http://127.0.0.1:${address.port}`;

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    controller: AbortController
  ): Promise<void> {
    const disconnected = () => {
      if (!response.writableFinished) controller.abort(new Error('Client disconnected.'));
    };
    request.once('aborted', disconnected);
    response.once('close', disconnected);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const actualAuthority = new URL(origin).host;
      const localAuthority = `localhost:${new URL(origin).port}`;
      if (request.headers.host !== actualAuthority && request.headers.host !== localAuthority)
        return sendError(response, 403);
      const requestOrigin = request.headers.origin;
      const sameOrigins = [origin, `http://${localAuthority}`, ...(options.allowedOrigins ?? [])];
      if (requestOrigin !== undefined && !sameOrigins.includes(requestOrigin))
        return sendError(response, 403);
      if (closing || active.size >= WEB_TRANSPORT_LIMITS.activeRequests)
        return sendError(response, 503);
      const path = request.url ?? '';
      if (
        request.method === 'GET' &&
        options.publicDirectory !== undefined &&
        !path.startsWith('/api/')
      ) {
        await serveStatic(options.publicDirectory, path, response);
        return;
      }
      if (request.method !== 'POST' || (path !== '/api/commands' && path !== '/api/interactions'))
        return sendError(response, 404);
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
        return sendError(response, 415);
      const body = await readRequest(request, controller.signal);
      if (path === '/api/commands') {
        const envelope = commandEnvelope.decode(body);
        const command = commands[commandName(envelope.command)];
        const value = await command.run(options.ports, envelope.input, controller.signal);
        controller.signal.throwIfAborted();
        const json = JSON.stringify(value, (_key, item: unknown) =>
          item === undefined ? null : item
        );
        if (Buffer.byteLength(json) > WEB_TRANSPORT_LIMITS.responseBytes) return fail();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(json);
      } else {
        const input = interactionInput.decode(body);
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        let terminal = false;
        let started = false;
        let bytes = 0;
        await options.ports.conversations.streamInteraction(
          { ...input, signal: controller.signal },
          async (event) => {
            controller.signal.throwIfAborted();
            const normalized = interactionEvent.decode(event);
            if (
              terminal ||
              normalized.interactionId !== input.interactionId ||
              (!started && normalized.type !== 'interaction-started') ||
              (started && normalized.type === 'interaction-started')
            )
              return fail();
            started = true;
            terminal =
              normalized.type === 'completed' ||
              normalized.type === 'failed' ||
              normalized.type === 'cancelled';
            const line = `${JSON.stringify(normalized)}\n`;
            bytes += Buffer.byteLength(line);
            if (
              Buffer.byteLength(line) > WEB_TRANSPORT_LIMITS.frameBytes ||
              bytes > WEB_TRANSPORT_LIMITS.streamBytes
            )
              return fail();
            if (!response.write(line)) await once(response, 'drain', { signal: controller.signal });
          }
        );
        if (!terminal) return fail();
        response.end();
      }
    } catch (error) {
      controller.abort(error);
      if (!response.headersSent && !response.destroyed)
        sendError(
          response,
          error instanceof TransportProtocolError || error instanceof SyntaxError ? 400 : 500
        );
      else response.destroy();
    } finally {
      request.off('aborted', disconnected);
      response.off('close', disconnected);
    }
  }
  async function closeHost(): Promise<void> {
    closing = true;
    for (const controller of active.keys())
      controller.abort(new Error('Local host shutting down.'));
    const stopped = new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    server.closeAllConnections();
    await Promise.all([...active.values()]);
    await stopped;
  }
  return Object.freeze({
    origin,
    // Every shutdown caller observes the same drainage, not an early second return.
    close: () => (closePromise ??= closeHost()),
  });
}

function sendError(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(
    JSON.stringify({
      code: 'WEB_TRANSPORT_REJECTED',
      message: 'The local application request could not be accepted.',
    })
  );
}

async function readRequest(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const raw of request) {
    signal.throwIfAborted();
    const chunk: unknown = raw;
    if (!Buffer.isBuffer(chunk)) return fail();
    bytes += chunk.byteLength;
    if (bytes > WEB_TRANSPORT_LIMITS.requestBytes) return fail();
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
