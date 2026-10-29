import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path';
import type { AgentWebConfig } from '../../application/agent-config.js';
import type { AgentWebPorts } from '../../application/ports.js';
import {
  directoryReference,
  type DirectoryCollectionChoice,
  type DirectoryCollectionReference,
  type DirectoryListing,
} from '../../collection/directory-contracts.js';
import { createAgentBaseWebPorts } from '../agent-base/backend.js';
import type { WebBackendOptions } from '../agent-base/profile.js';

export interface DirectoryCollectionHost {
  /** Stop/join business calls first; closes every owned Collection backend, including Memory roots. */
  close(): Promise<void>;
  bootstrap(
    signal: AbortSignal
  ): Promise<Readonly<{ initialCollection?: DirectoryCollectionChoice }>>;
  open(
    reference: unknown,
    signal: AbortSignal
  ): Promise<
    | Readonly<{ ok: true; collection: DirectoryCollectionChoice }>
    | Readonly<{ ok: false; message: string }>
  >;
  browse(path: string, signal: AbortSignal): Promise<DirectoryListing>;
  resolve(key: string): AgentWebPorts<AgentWebConfig> | undefined;
}

export async function createDirectoryCollectionHost(
  options: Omit<WebBackendOptions, 'persistence'> & { readonly initialRoot?: string } = {}
): Promise<DirectoryCollectionHost> {
  const bindings = new Map<string, ReturnType<typeof createAgentBaseWebPorts>>();
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  let openForAdmission = true;
  let initialCollection: DirectoryCollectionChoice | undefined;
  const performOpen = async (input: unknown, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!openForAdmission) throw new Error('Collection host is closed.');
    const reference = directoryReference.decode(input);
    try {
      const requested = checkedPath(reference.rootDirectory);
      await mkdir(requested, { recursive: true });
      signal.throwIfAborted();
      const canonical = await realpath(requested);
      if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory');
      checkedPath(canonical);
      await access(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
      signal.throwIfAborted();
      if (!openForAdmission) throw new Error('Collection host is closed.');
      const key = `directory-${createHash('sha256').update(canonical).digest('hex')}`;
      if (!bindings.has(key)) {
        if (bindings.size >= 128)
          return {
            ok: false as const,
            message:
              'Too many Collections are open in this host. Restart the host before opening more.',
          };
        // One services instance per canonical directory retains independent runtime fences.
        bindings.set(
          key,
          createAgentBaseWebPorts({
            ...options,
            persistence: { kind: 'directory', rootDirectory: canonical },
          })
        );
      }
      const locator: DirectoryCollectionReference = Object.freeze({ rootDirectory: canonical });
      return {
        ok: true as const,
        collection: Object.freeze({
          key,
          label: basename(canonical),
          description: canonical,
          reference: locator,
        }),
      };
    } catch {
      signal.throwIfAborted();
      return {
        ok: false as const,
        message:
          'The Collection directory could not be opened. Use an absolute, writable directory path (not a filesystem root).',
      };
    }
  };
  const open: DirectoryCollectionHost['open'] = (input, signal) => {
    const work = performOpen(input, signal);
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => undefined);
    return work;
  };
  if (options.initialRoot !== undefined) {
    const result = await open(
      { rootDirectory: resolve(options.initialRoot) },
      new AbortController().signal
    );
    if (!result.ok) throw new Error(result.message);
    initialCollection = result.collection;
  }
  return Object.freeze({
    open,
    close: () => {
      openForAdmission = false;
      closing ??= (async () => {
        await Promise.allSettled([...pending]);
        const results = await Promise.allSettled(
          [...bindings.values()].map((ports) => ports.close())
        );
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason as unknown] : []
        );
        if (failures.length !== 0)
          throw new AggregateError(failures, 'Collection resources could not be closed.');
        bindings.clear();
      })();
      return closing;
    },
    resolve: (key: string) => (openForAdmission ? bindings.get(key) : undefined),
    bootstrap: (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (!openForAdmission) throw new Error('Collection host is closed.');
      return Promise.resolve(initialCollection === undefined ? {} : { initialCollection });
    },
    browse: async (path: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (!openForAdmission) throw new Error('Collection host is closed.');
      const current = await realpath(path === '' ? homedir() : checkedPath(path, true));
      const entries = await readdir(current, { withFileTypes: true });
      signal.throwIfAborted();
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200)
        .map((entry) => ({ label: entry.name, rootDirectory: resolve(current, entry.name) }));
      const parent = dirname(current);
      return {
        rootDirectory: current,
        ...(parent === current ? {} : { parentDirectory: parent }),
        directories,
      };
    },
  });
}
function checkedPath(path: string, allowRoot = false): string {
  if (
    !isAbsolute(path) ||
    path.includes('\0') ||
    (!allowRoot && resolve(path) === parse(path).root)
  )
    throw new Error('Invalid Collection path');
  return resolve(path);
}
