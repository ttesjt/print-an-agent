import {
  readJsonRequest,
  writeJsonResponse,
  writeInteractionResponse,
} from '@ta-agent/ui-transport/node';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AgentWebPorts } from '../../application/ports.js';
import type { AgentWebConfig } from '../../application/agent-config.js';
import { commandName, commands } from '../../transport/commands.js';
import { fail, object, text, TransportProtocolError } from '../../transport/decoder.js';
import { WEB_TRANSPORT_LIMITS } from '../../transport/limits.js';
import { serveStatic } from './static.js';
import type { DirectoryCollectionHost } from '../collections/directory-host.js';
import { writeTemporaryConversationResponse } from './temporary-conversations.js';

export interface LocalServerOptions {
  /** Optional explicit ownership delegation. Without it, this transport only borrows ports/Collections. */
  readonly closeResources?: () => Promise<void>;
  /** Explicit fixed binding for embedded applications/qualification. */
  readonly ports?: AgentWebPorts<AgentWebConfig>;
  readonly collections?: DirectoryCollectionHost;
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
  if ((options.ports === undefined) === (options.collections === undefined))
    throw new Error('Provide exactly one fixed binding or Collection host.');
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
      const scoped =
        /^\/api\/collections\/([a-zA-Z0-9-]+)\/(commands|interactions|temporary-conversations)$/u.exec(
          path
        );
      if (
        request.method !== 'POST' ||
        (path !== '/api/collections' &&
          path !== '/api/commands' &&
          path !== '/api/interactions' &&
          path !== '/api/temporary-conversations' &&
          scoped === null)
      )
        return sendError(response, 404);
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
        return sendError(response, 415);
      const body = await readJsonRequest(request, controller.signal);
      if (path === '/api/collections') {
        const host = options.collections;
        if (host === undefined) return sendError(response, 404);
        const envelope = commandEnvelope.decode(body);
        let value: unknown;
        if (envelope.command === 'bootstrap') {
          object({}).decode(envelope.input);
          value = await host.bootstrap(controller.signal);
        } else if (envelope.command === 'open')
          value = await host.open(envelope.input, controller.signal);
        else if (envelope.command === 'browse')
          value = await host.browse(
            object({ rootDirectory: text(4096) }).decode(envelope.input).rootDirectory,
            controller.signal
          );
        else return fail();
        controller.signal.throwIfAborted();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(value));
        return;
      }
      const ports = scoped === null ? options.ports : options.collections?.resolve(scoped[1] ?? '');
      if (ports === undefined) return sendError(response, 404);
      if (path === '/api/commands' || scoped?.[2] === 'commands') {
        const envelope = commandEnvelope.decode(body);
        const command = commands[commandName(envelope.command)];
        const value = await command.run(ports, envelope.input, controller.signal);
        controller.signal.throwIfAborted();
        writeJsonResponse(response, value);
      } else if (
        path === '/api/temporary-conversations' ||
        scoped?.[2] === 'temporary-conversations'
      ) {
        if (ports.temporaryConversations === undefined) return sendError(response, 404);
        await writeTemporaryConversationResponse(
          ports.temporaryConversations,
          body,
          response,
          controller.signal
        );
      } else {
        await writeInteractionResponse(ports.conversations, body, response, controller.signal);
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
    const settlements = await Promise.allSettled([...active.values(), stopped]);
    const failures = settlements.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : []
    );
    // Initialization cancellation is not business cancellation; never close the setup before joining work.
    try {
      await options.closeResources?.();
    } catch (cause) {
      failures.push(cause);
    }
    if (failures.length !== 0) throw new AggregateError(failures, 'Local host shutdown failed.');
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
