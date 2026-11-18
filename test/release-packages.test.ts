import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  PACKAGE_DIRECTORIES,
  REGISTRY,
  REPOSITORY,
  ROOT,
  readJson,
  releasePackages,
  type PackageManifest,
} from '../tooling/release/packages.ts';

it('publishes only the reviewed entry-point production closure, in dependency order', () => {
  const packages = releasePackages();
  expect(packages).toHaveLength(10);
  const visited = new Set<string>();
  for (const { directory, manifest } of packages) {
    expect(manifest.private).toBe(false);
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository).toEqual({ type: 'git', url: `${REPOSITORY}.git`, directory });
    expect(manifest.publishConfig).toEqual({ access: 'public', registry: REGISTRY });
    expect(manifest.files).toContain('LICENSE');
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@print-an-agent/')) {
        expect(visited.has(name), `${manifest.name} depends on ${name}`).toBe(true);
        expect(spec).toBe('workspace:*');
      }
    }
    visited.add(manifest.name);
  }
});

it('keeps every unselected workspace package and the root private', () => {
  const publicPackages = new Set<string>(Object.keys(PACKAGE_DIRECTORIES));
  const inspect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.venv', '__pycache__'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (entry.name === 'package.json') {
        const manifest = readJson<PackageManifest>(path);
        if (!publicPackages.has(manifest.name)) expect(manifest.private, path).toBe(true);
      }
    }
  };
  inspect(join(ROOT, 'modules'));
  expect(readJson<PackageManifest>(join(ROOT, 'package.json')).private).toBe(true);
});
