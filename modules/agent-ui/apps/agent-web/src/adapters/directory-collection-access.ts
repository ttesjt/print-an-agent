import type { CollectionAccessPort } from '@ta-agent/ui-contracts';
import { createHttpAgentWebPorts } from './http-agent-web-ports.js';
import { connectHttpMemory } from '../memory/browser.js';
import type { CollectionConnection } from '../collection/collection-application.js';
import {
  collectionBootstrap,
  directoryListing,
  directoryOpenReceipt,
  type DirectoryCollectionReference,
} from '../collection/directory-contracts.js';
import { object, text } from '../transport/decoder.js';

export type DirectoryCollectionAccess = CollectionAccessPort<
  CollectionConnection,
  DirectoryCollectionReference
> & {
  readonly bootstrap: (
    signal: AbortSignal
  ) => Promise<ReturnType<typeof collectionBootstrap.decode>>;
  readonly browse: (
    path: string,
    signal: AbortSignal
  ) => Promise<ReturnType<typeof directoryListing.decode>>;
};
export function createDirectoryCollectionAccess(
  baseUrl = '/api',
  request: typeof fetch = globalThis.fetch
): DirectoryCollectionAccess {
  const base = baseUrl.replace(/\/$/u, '');
  const call = async (command: string, input: unknown, signal: AbortSignal): Promise<unknown> => {
    const response = await request(`${base}/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, input }),
      signal,
    });
    if (!response.ok)
      throw new Error('The Collection host is unavailable or rejected this request.');
    const raw = await response.text();
    if (raw.length > 100_000) throw new Error('Collection response exceeded the limit.');
    signal.throwIfAborted();
    return JSON.parse(raw) as unknown;
  };
  const access: DirectoryCollectionAccess = {
    bootstrap: async (signal) => collectionBootstrap.decode(await call('bootstrap', {}, signal)),
    browse: async (path, signal) =>
      directoryListing.decode(
        await call(
          'browse',
          object({ rootDirectory: text(4096) }).decode({ rootDirectory: path }),
          signal
        )
      ),
    openCollection: async ({ reference, signal }) => {
      const result = directoryOpenReceipt.decode(await call('open', reference, signal));
      if (!result.ok) return result;
      const connectionOptions = {
        baseUrl: `${base}/collections/${encodeURIComponent(result.collection.key)}`,
        fetch: request,
      };
      const memory = await connectHttpMemory(connectionOptions, signal);
      return {
        ok: true,
        collection: result.collection,
        connection: {
          profileLabel: 'Local Agent Base',
          ports: { ...createHttpAgentWebPorts(connectionOptions), memory },
        },
      };
    },
  };
  return Object.freeze(access);
}
