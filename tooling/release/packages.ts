import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const REGISTRY = 'https://registry.npmjs.org/';
export const REPOSITORY = 'https://github.com/ttesjt/print-an-agent';
export const ENTRIES = [
  '@print-an-agent/base-request',
  '@print-an-agent/base-runtime',
  '@print-an-agent/model-invocation-core',
  '@print-an-agent/model-invocation-pi',
] as const;

/** The reviewed production closure. A new dependency requires an explicit release-scope review. */
export const PACKAGE_DIRECTORIES = {
  '@print-an-agent/model-invocation-core': 'modules/model-invocation/packages/core',
  '@print-an-agent/model-invocation-pi': 'modules/model-invocation/packages/pi',
  '@print-an-agent/workflow-core': 'modules/workflow/packages/core',
  '@print-an-agent/base-identity': 'modules/agent-base/packages/identity',
  '@print-an-agent/base-observability': 'modules/agent-base/packages/observability',
  '@print-an-agent/base-runtime': 'modules/agent-base/packages/runtime',
  '@print-an-agent/base-tool': 'modules/agent-base/packages/tool',
  '@print-an-agent/base-actor': 'modules/agent-base/packages/actor',
  '@print-an-agent/base-session': 'modules/agent-base/packages/session',
  '@print-an-agent/base-request': 'modules/agent-base/packages/request',
} as const;

export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  description: string;
  type: string;
  main: string;
  types: string;
  exports: Record<string, { types: string; import: string }>;
  files: string[];
  license: string;
  engines: Record<string, string>;
  repository: { type: string; url: string; directory: string };
  publishConfig: { access: string; registry: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface ReleasePackage {
  name: string;
  filename: string;
  integrity: string;
  manifest: PackageManifest;
}

export interface PreparedRelease {
  version: string;
  source: { commit: string; dirty: boolean };
  entries: readonly string[];
  packages: ReleasePackage[];
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function releasePackages(): { directory: string; manifest: PackageManifest }[] {
  const visited = new Set<string>();
  const ordered: { directory: string; manifest: PackageManifest }[] = [];
  const pending = new Set<string>();
  const directories: Readonly<Record<string, string>> = PACKAGE_DIRECTORIES;
  const visit = (name: string): void => {
    if (pending.has(name)) throw new Error(`Release dependency cycle at ${name}.`);
    if (visited.has(name)) return;
    const directory = directories[name];
    if (directory === undefined) throw new Error(`Unreviewed release dependency ${name}.`);
    const manifest = readJson<PackageManifest>(resolve(ROOT, directory, 'package.json'));
    if (manifest.name !== name) throw new Error(`Unexpected package identity at ${directory}.`);
    pending.add(name);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@print-an-agent/')) visit(dependency);
    }
    pending.delete(name);
    visited.add(name);
    ordered.push({ directory, manifest });
  };
  ENTRIES.forEach(visit);
  if (visited.size !== Object.keys(directories).length)
    throw new Error('The release whitelist differs from the entry-point production closure.');
  return ordered;
}
