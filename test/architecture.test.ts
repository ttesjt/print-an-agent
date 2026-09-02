import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
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
  for (const collection of ['apps', 'clients', 'packages', 'tests']) {
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

function typeScriptFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(entryPath);
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function moduleSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const pattern = /\b(?:from|import)\s*(?:\([^)]*?\)|[^'"\n]*?from\s*)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveDeclarationImport(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const absolute = resolve(dirname(importer), specifier);
  const candidates =
    extname(absolute) === '.js'
      ? [`${absolute.slice(0, -3)}.d.ts`]
      : [`${absolute}.d.ts`, join(absolute, 'index.d.ts')];
  return candidates.find((candidate) => existsSync(candidate));
}

function reachablePublicDeclarations(entryPoint: string): readonly string[] {
  const pending = [entryPoint];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const declaration = pending.pop();
    if (declaration === undefined || visited.has(declaration)) continue;
    visited.add(declaration);
    for (const specifier of moduleSpecifiers(readFileSync(declaration, 'utf8'))) {
      const dependency = resolveDeclarationImport(declaration, specifier);
      if (dependency !== undefined) pending.push(dependency);
    }
  }
  return Object.freeze([...visited]);
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
      const typeboxDependency = manifest.dependencies?.typebox;

      if (entry.name === 'pi') {
        expect(manifest.dependencies?.['@earendil-works/pi-ai']).toBe('0.82.1');
        expect(manifest.dependencies?.['@earendil-works/pi-agent-core']).toBe('0.82.1');
        expect(piDependencies).toEqual(['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']);
        expect(typeboxDependency).toBe('1.1.38');
        for (const publicSource of ['index.ts', 'types.ts']) {
          const source = readFileSync(join(packagesRoot, entry.name, 'src', publicSource), 'utf8');
          expect(source).not.toContain('@earendil-works/pi-');
          expect(source).not.toContain("from 'typebox'");
        }
        continue;
      }

      expect(piDependencies, `${manifest.name ?? entry.name} must not depend on Pi`).toEqual([]);
      expect(typeboxDependency, `${manifest.name ?? entry.name} must not depend on TypeBox`).toBe(
        undefined
      );
      expect(
        containsTextInTypeScript(join(packagesRoot, entry.name, 'src'), '@earendil-works/pi-'),
        `${manifest.name ?? entry.name} production source must not import Pi`
      ).toBe(false);
      expect(
        containsTextInTypeScript(join(packagesRoot, entry.name, 'src'), "from 'typebox'")
      ).toBe(false);
    }
  });

  it('keeps generic Agent Base domains independent from official local adapters', () => {
    const packagesRoot = join(repositoryRoot, 'modules', 'agent-base', 'packages');
    const domainPackages = ['config', 'identity', 'observability', 'request', 'session'];
    for (const packageName of domainPackages) {
      const packageRoot = join(packagesRoot, packageName);
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, 'package.json'), 'utf8')
      ) as PackageManifest;
      expect(declaredDependencies(manifest)).not.toContain('@ta-agent/base-local-adapters');
      expect(
        containsTextInTypeScript(join(packageRoot, 'test'), '@ta-agent/base-local-adapters'),
        `${manifest.name ?? packageName} tests must use local fakes instead of official adapters`
      ).toBe(false);
    }

    for (const adapterSource of [
      join(packagesRoot, 'config', 'src', 'adapters'),
      join(packagesRoot, 'identity', 'src', 'catalog', 'adapters'),
      join(packagesRoot, 'observability', 'src', 'adapters'),
      join(packagesRoot, 'request', 'src', 'adapters'),
      join(packagesRoot, 'request', 'src', 'replay', 'adapters'),
      join(packagesRoot, 'session', 'src', 'adapters'),
    ]) {
      expect(
        typeScriptFiles(adapterSource),
        `${normalize(adapterSource)} must stay implementation-free`
      ).toEqual([]);
    }

    const localManifest = JSON.parse(
      readFileSync(join(packagesRoot, 'local-adapters', 'package.json'), 'utf8')
    ) as PackageManifest;
    expect(Object.keys(localManifest.dependencies ?? {}).sort()).toEqual([
      '@ta-agent/base-config',
      '@ta-agent/base-identity',
      '@ta-agent/base-model',
      '@ta-agent/base-observability',
      '@ta-agent/base-request',
      '@ta-agent/base-session',
    ]);
  });

  it('keeps the Agent Base CLI thin over the standalone Agent package', () => {
    const cliRoot = join(repositoryRoot, 'modules', 'agent-base', 'apps', 'cli');
    const manifest = JSON.parse(
      readFileSync(join(cliRoot, 'package.json'), 'utf8')
    ) as PackageManifest;
    const agentBaseRuntimeDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith('@ta-agent/base-')
    );

    expect(agentBaseRuntimeDependencies).toEqual(['@ta-agent/base-standalone-agent']);
    for (const forbiddenImport of [
      '@ta-agent/base-pi',
      '@ta-agent/base-model',
      '@ta-agent/base-request',
      '@ta-agent/base-session',
      '@ta-agent/base-composition',
      '@earendil-works/pi-',
    ]) {
      expect(containsTextInTypeScript(join(cliRoot, 'src'), forbiddenImport)).toBe(false);
    }
  });

  it('keeps the standalone Agent independent of the Pi adapter', () => {
    const standaloneRoot = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'standalone-agent'
    );
    const manifest = JSON.parse(
      readFileSync(join(standaloneRoot, 'package.json'), 'utf8')
    ) as PackageManifest;

    expect(declaredDependencies(manifest)).not.toContain('@ta-agent/base-pi');
    expect(containsTextInTypeScript(join(standaloneRoot, 'src'), '@ta-agent/base-pi')).toBe(false);
    expect(containsTextInTypeScript(join(standaloneRoot, 'src'), '@earendil-works/pi-')).toBe(
      false
    );
  });

  it('keeps composition public contracts free of Pi names and types', () => {
    const compositionSource = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'composition',
      'src'
    );
    for (const publicContractFile of [
      'index.ts',
      'types.ts',
      'provider-contracts.ts',
      'deterministic-provider-contracts.ts',
    ]) {
      const source = readFileSync(join(compositionSource, publicContractFile), 'utf8');
      expect(source).not.toContain('@ta-agent/base-pi');
      expect(source).not.toMatch(/\bPi[A-Z]/);
    }
  });

  it('keeps non-Pi Agent Base public declaration graphs free of adapter type leaks', () => {
    const roots = [
      join(repositoryRoot, 'modules', 'agent-base', 'apps'),
      join(repositoryRoot, 'modules', 'agent-base', 'packages'),
    ];
    for (const root of roots) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'pi') continue;
        const declarationEntry = join(root, entry.name, 'dist', 'index.d.ts');
        expect(
          existsSync(declarationEntry),
          `${normalize(declarationEntry)} must exist before declaration qualification`
        ).toBe(true);
        for (const declaration of reachablePublicDeclarations(declarationEntry)) {
          const source = readFileSync(declaration, 'utf8');
          for (const forbidden of [
            '@earendil-works/pi-',
            '@ta-agent/base-pi',
            "from 'typebox'",
            'from "typebox"',
            "from 'node:sqlite'",
            'from "node:sqlite"',
          ]) {
            expect(
              source.includes(forbidden),
              `${normalize(declaration)} must not expose ${forbidden}`
            ).toBe(false);
          }
        }
      }
    }
  });

  it('keeps Agent Base module integration tests on public package entry points', () => {
    const consumerRoot = join(repositoryRoot, 'modules', 'agent-base', 'tests', 'integration');
    const manifest = JSON.parse(
      readFileSync(join(consumerRoot, 'package.json'), 'utf8')
    ) as PackageManifest;
    for (const dependency of declaredDependencies(manifest)) {
      expect(dependency.startsWith('@ta-agent/workbench-')).toBe(false);
      expect(dependency.startsWith('@ta-agent/self-learn-')).toBe(false);
      expect(dependency.startsWith('@earendil-works/')).toBe(false);
      expect(dependency).not.toBe('typebox');
    }
    for (const sourceFile of typeScriptFiles(join(consumerRoot, 'test'))) {
      for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
        if (!specifier.startsWith('@ta-agent/')) continue;
        expect(specifier).toMatch(/^@ta-agent\/base-[^/]+$/);
      }
      expect(normalize(sourceFile)).not.toContain(`${normalize('/src/')}`);
    }
  });
});
