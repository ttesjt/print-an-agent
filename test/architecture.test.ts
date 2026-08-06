import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

const moduleRules = Object.freeze({
  'model-workbench': {
    packagePrefix: '@ta-agent/workbench-',
    forbiddenPrefixes: ['@ta-agent/base-', '@ta-agent/self-learn-'],
  },
  'agent-base': {
    packagePrefix: '@ta-agent/base-',
    forbiddenPrefixes: ['@ta-agent/workbench-', '@ta-agent/self-learn-'],
  },
});

type ModuleName = keyof typeof moduleRules;

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function packageManifests(moduleName: ModuleName): readonly PackageManifest[] {
  const manifests: PackageManifest[] = [];
  for (const collection of ['apps', 'clients', 'packages']) {
    const collectionPath = join(repositoryRoot, 'modules', moduleName, collection);
    if (!existsSync(collectionPath)) continue;

    for (const entry of readdirSync(collectionPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(collectionPath, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      manifests.push(JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest);
    }
  }
  return manifests;
}

function declaredDependencies(manifest: PackageManifest): readonly string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
}

function containsTestFile(directory: string): boolean {
  if (!existsSync(directory)) return false;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory() && containsTestFile(entryPath)) return true;
    if (entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return true;
  }

  return false;
}

function containsTextInTypeScript(directory: string, pattern: string): boolean {
  if (!existsSync(directory)) return false;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory() && containsTextInTypeScript(entryPath, pattern)) return true;
    if (
      entry.isFile() &&
      /\.[cm]?tsx?$/.test(entry.name) &&
      readFileSync(entryPath, 'utf8').includes(pattern)
    ) {
      return true;
    }
  }
  return false;
}

describe('module architecture', () => {
  it('keeps product code out of the framework workspace', () => {
    expect(existsSync(join(repositoryRoot, 'modules', 'self-learn-agent'))).toBe(false);
  });

  for (const [moduleName, rule] of Object.entries(moduleRules) as Array<
    [ModuleName, (typeof moduleRules)[ModuleName]]
  >) {
    it(`${moduleName} is an explicit repository capsule`, () => {
      const moduleRoot = join(repositoryRoot, 'modules', moduleName);
      expect(existsSync(join(moduleRoot, 'README.md'))).toBe(true);
      for (const requiredDirectory of ['apps', 'clients', 'configs', 'docs', 'packages', 'tests']) {
        expect(existsSync(join(moduleRoot, requiredDirectory))).toBe(true);
      }
    });

    it(`${moduleName} packages use their ownership prefix`, () => {
      for (const manifest of packageManifests(moduleName)) {
        expect(manifest.name, 'Every workspace package must declare a name').toBeDefined();
        expect(manifest.name?.startsWith(rule.packagePrefix)).toBe(true);
      }
    });

    it(`${moduleName} dependencies respect the directed module graph`, () => {
      for (const manifest of packageManifests(moduleName)) {
        for (const dependency of declaredDependencies(manifest)) {
          expect(
            rule.forbiddenPrefixes.some((prefix) => dependency.startsWith(prefix)),
            `${manifest.name ?? '<unnamed>'} must not depend on ${dependency}`
          ).toBe(false);
        }
      }
    });

    it(`${moduleName} production source does not contain test files`, () => {
      for (const collection of ['apps', 'clients', 'packages']) {
        const collectionPath = join(repositoryRoot, 'modules', moduleName, collection);
        if (!existsSync(collectionPath)) continue;

        for (const entry of readdirSync(collectionPath, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          expect(containsTestFile(join(collectionPath, entry.name, 'src'))).toBe(false);
        }
      }
    });
  }

  it('isolates exact Pi dependencies and imports to the Agent Base Pi adapter', () => {
    const packagesRoot = join(repositoryRoot, 'modules', 'agent-base', 'packages');
    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(packagesRoot, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
      const piDependencies = declaredDependencies(manifest).filter((dependency) =>
        dependency.startsWith('@earendil-works/pi-')
      );

      if (entry.name === 'pi') {
        expect(manifest.dependencies?.['@earendil-works/pi-ai']).toBe('0.82.1');
        expect(manifest.dependencies?.['@earendil-works/pi-agent-core']).toBe('0.82.1');
        expect(piDependencies).toEqual(['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']);
        continue;
      }

      expect(piDependencies, `${manifest.name ?? entry.name} must not depend on Pi`).toEqual([]);
      expect(
        containsTextInTypeScript(join(packagesRoot, entry.name, 'src'), '@earendil-works/pi-'),
        `${manifest.name ?? entry.name} production source must not import Pi`
      ).toBe(false);
    }
  });
});
