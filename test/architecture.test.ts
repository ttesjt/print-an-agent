import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep as pathSeparator,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

const ignoredTraversalDirectories = new Set([
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
  'dist',
  'node_modules',
]);

function isIgnoredTraversalDirectory(name: string): boolean {
  return ignoredTraversalDirectories.has(name);
}

function packageManifests(moduleName: ModuleName): readonly PackageManifest[] {
  const manifests: PackageManifest[] = [];
  for (const collection of ['apps', 'packages', 'templates', 'tests']) {
    const collectionPath = join(repositoryRoot, 'modules', moduleName, collection);
    if (!existsSync(collectionPath)) continue;
    collectPackageManifests(collectionPath, manifests);
  }
  return manifests;
}

function collectPackageManifests(directory: string, manifests: PackageManifest[]): void {
  const manifestPath = join(directory, 'package.json');
  if (existsSync(manifestPath)) {
    manifests.push(JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest);
    return;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || isIgnoredTraversalDirectory(entry.name)) continue;
    collectPackageManifests(join(directory, entry.name), manifests);
  }
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

function containsTestFileInProductionSources(directory: string): boolean {
  if (!existsSync(directory)) return false;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || isIgnoredTraversalDirectory(entry.name)) continue;
    const entryPath = join(directory, entry.name);
    if (entry.name === 'src') {
      if (containsTestFile(entryPath)) return true;
      continue;
    }
    if (containsTestFileInProductionSources(entryPath)) return true;
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
    if (entry.isDirectory()) {
      return isIgnoredTraversalDirectory(entry.name) ? [] : typeScriptFiles(entryPath);
    }
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function moduleSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    'architecture-input.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const recordStringLiteral = (value: ts.Node | undefined): void => {
    if (value !== undefined && ts.isStringLiteralLike(value)) {
      specifiers.push(value.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      recordStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      recordStringLiteral(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      recordStringLiteral(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return Object.freeze(specifiers);
}

function resolveSourceModuleTarget(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  return normalize(resolve(dirname(importer), specifier).replace(/\.(?:c|m)?js$/u, ''));
}

function isPathWithin(candidate: string, directory: string): boolean {
  const relativePath = relative(directory, candidate);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${pathSeparator}`) &&
      !isAbsolute(relativePath))
  );
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
      for (const requiredDirectory of ['apps', 'configs', 'docs', 'packages', 'tests']) {
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
      for (const collection of ['apps', 'packages', 'templates']) {
        const collectionPath = join(repositoryRoot, 'modules', moduleName, collection);
        if (!existsSync(collectionPath)) continue;
        expect(containsTestFileInProductionSources(collectionPath)).toBe(false);
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

  it('keeps Agent Base CLI host loading private to the executable application', () => {
    const cliSource = join(repositoryRoot, 'modules', 'agent-base', 'apps', 'cli', 'src');
    const publicEntryPoint = readFileSync(join(cliSource, 'index.ts'), 'utf8');
    const executableEntryPoint = readFileSync(join(cliSource, 'main.ts'), 'utf8');

    expect(moduleSpecifiers(publicEntryPoint)).not.toContain('./host-loaders.js');
    for (const privateHostLoader of [
      'loadAgentBaseCliAgentManager',
      'loadAgentBaseCliProvider',
      'loadAgentBaseCliRuntime',
      'loadAgentBaseCliSessionManager',
      'readAgentBaseCliJsonDocument',
    ]) {
      expect(publicEntryPoint).not.toContain(privateHostLoader);
      expect(executableEntryPoint).toContain(privateHostLoader);
    }
    expect(moduleSpecifiers(executableEntryPoint)).toContain('./host-loaders.js');
  });

  it('keeps cross-package Agent Base consumers on package-root public APIs', () => {
    const modulesRoot = join(repositoryRoot, 'modules');
    const deepImports: string[] = [];

    for (const sourceFile of typeScriptFiles(modulesRoot)) {
      for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
        if (/^@ta-agent\/base-[^/]+\//u.test(specifier)) {
          deepImports.push(`${normalize(relative(repositoryRoot, sourceFile))}: ${specifier}`);
        }
      }
    }

    expect(deepImports).toEqual([]);
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

  it('keeps Agent Base composition independent of the Standalone profile', () => {
    const compositionRoot = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'composition'
    );
    const manifest = JSON.parse(
      readFileSync(join(compositionRoot, 'package.json'), 'utf8')
    ) as PackageManifest;

    expect(declaredDependencies(manifest)).not.toContain('@ta-agent/base-standalone-agent');
    expect(
      containsTextInTypeScript(join(compositionRoot, 'src'), '@ta-agent/base-standalone-agent')
    ).toBe(false);
  });

  it('routes Standalone bootstrap through profiles and Services, not a second runtime assembly', () => {
    const sourceRoot = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'standalone-agent',
      'src'
    );
    const bootstrap = readFileSync(join(sourceRoot, 'create-standalone-agent.ts'), 'utf8');
    const specifiers = moduleSpecifiers(bootstrap);
    expect(specifiers).toContain('./profiles/memory.js');
    expect(specifiers).toContain('./profiles/shared-sqlite.js');
    expect(specifiers).not.toContain('@ta-agent/base-local-adapters');
    // The runtime Ports type is allowed; bootstrap must not call the materializer itself.
    expect(bootstrap).not.toContain('materializeStandaloneAgentRuntime');
    expect(bootstrap).toContain('createAgentManagementService');
    expect(bootstrap).toContain('createAgentRuntimeService');
    const materializer = readFileSync(
      join(sourceRoot, 'runtime', 'materialize-standalone-agent.ts'),
      'utf8'
    );
    expect(moduleSpecifiers(materializer)).not.toContain('@ta-agent/base-local-adapters');
    expect(materializer).not.toContain('createProviderAgentAPI');
    expect(materializer).not.toContain('createAgentAPI');
    expect(materializer).not.toContain('ports?:');
  });

  it('keeps Standalone runtime assembly singular and concrete adapters inside provisioning', () => {
    const sourceRoot = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'standalone-agent',
      'src'
    );
    const materializer = normalize(join(sourceRoot, 'runtime', 'materialize-standalone-agent.ts'));
    const composeAgentOwners = typeScriptFiles(sourceRoot)
      .filter((sourceFile) => /\bcomposeAgent\s*\(/u.test(readFileSync(sourceFile, 'utf8')))
      .map(normalize);
    expect(composeAgentOwners).toEqual([materializer]);

    const resourcesRoot = join(sourceRoot, 'resources');
    for (const sourceFile of typeScriptFiles(sourceRoot)) {
      if (isPathWithin(sourceFile, resourcesRoot)) continue;
      expect(
        moduleSpecifiers(readFileSync(sourceFile, 'utf8')).some(
          (specifier) => specifier === '@ta-agent/base-local-adapters'
        ),
        `${normalize(sourceFile)} must receive provisioned Ports instead of selecting local adapters`
      ).toBe(false);
    }

    const publicEntryPoint = readFileSync(join(sourceRoot, 'index.ts'), 'utf8');
    expect(publicEntryPoint).toContain('export { createStandaloneAgent }');
    expect(publicEntryPoint).toContain('createStandaloneMemoryDefinition');
    expect(publicEntryPoint).toContain('createStandaloneDirectoryDefinition');
    expect(publicEntryPoint).toContain('createSharedSqliteStandaloneDefinition');
    expect(publicEntryPoint).not.toContain('ResourceProvisioner');
  });

  it('keeps Standalone as a profile consumer instead of a duplicate lifecycle owner', () => {
    const standaloneSource = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'standalone-agent',
      'src'
    );
    for (const removedFeature of ['managed-agent', 'managed-directory', 'managed-session']) {
      expect(typeScriptFiles(join(standaloneSource, removedFeature))).toEqual([]);
    }

    const sourceText = typeScriptFiles(standaloneSource)
      .map((sourceFile) => readFileSync(sourceFile, 'utf8'))
      .join('\n');
    for (const removedOwner of [
      'ManagedStandaloneAgentRegistry',
      'createManagedStandaloneAgentRegistry',
      'createManagedStandaloneSessionService',
      'createStandaloneAgentDirectory',
      'createSharedSqliteStandaloneAgentRegistry',
    ]) {
      expect(sourceText).not.toContain(removedOwner);
    }
    for (const genericConsumer of [
      'defineManagedAgentComposition',
      'createAgentManagementService',
      'createAgentRuntimeService',
      'createSessionManagementService',
    ]) {
      expect(sourceText).toContain(genericConsumer);
    }
  });

  it('extracts static, exported, dynamic, and type-only module references', () => {
    const source = `
      import value from './static.js';
      import type { Contract } from './contract.js';
      export * from './exported.js';
      await import('./dynamic.js');
      type InlineContract = import('./inline-contract.js').InlineContract;
    `;

    expect(moduleSpecifiers(source)).toEqual([
      './static.js',
      './contract.js',
      './exported.js',
      './dynamic.js',
      './inline-contract.js',
    ]);
  });

  it('keeps composition runtime and management as isolated peer features', () => {
    const compositionSource = join(
      repositoryRoot,
      'modules',
      'agent-base',
      'packages',
      'composition',
      'src'
    );
    const rootEntries = readdirSync(compositionSource, { withFileTypes: true });
    expect(
      rootEntries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['index.ts']);
    const rootDirectories = rootEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(rootDirectories).toContain('runtime');
    expect(
      rootDirectories.every(
        (directoryName) => directoryName === 'runtime' || directoryName === 'management'
      )
    ).toBe(true);

    const rootSpecifiers = moduleSpecifiers(
      readFileSync(join(compositionSource, 'index.ts'), 'utf8')
    );
    expect(rootSpecifiers).toContain('./runtime/index.js');
    expect(
      rootSpecifiers.every(
        (specifier) => specifier === './runtime/index.js' || specifier === './management/index.js'
      )
    ).toBe(true);

    const assertFeatureIsolation = (
      featureName: 'runtime' | 'management',
      forbiddenPeer: 'runtime' | 'management'
    ) => {
      const featureRoot = join(compositionSource, featureName);
      if (!existsSync(featureRoot)) return;
      const forbiddenPeerRoot = join(compositionSource, forbiddenPeer);
      const packageRootIndex = join(compositionSource, 'index');

      for (const sourceFile of typeScriptFiles(featureRoot)) {
        for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
          const relativeTarget = resolveSourceModuleTarget(sourceFile, specifier);
          expect(
            specifier === '@ta-agent/base-composition' ||
              specifier.startsWith('@ta-agent/base-composition/') ||
              relativeTarget === compositionSource ||
              relativeTarget === packageRootIndex ||
              (relativeTarget !== undefined && isPathWithin(relativeTarget, forbiddenPeerRoot)),
            `${normalize(sourceFile)} must not import the composition root or ${forbiddenPeer}/`
          ).toBe(false);
        }
      }
    };

    assertFeatureIsolation('runtime', 'management');
    assertFeatureIsolation('management', 'runtime');

    const managementRoot = join(compositionSource, 'management');
    if (existsSync(managementRoot)) {
      const forbiddenManagementImports = [
        '@ta-agent/base-local-adapters',
        '@ta-agent/base-pi',
        '@ta-agent/base-standalone-agent',
        'node:fs',
        'node:path',
        'node:sqlite',
      ];
      for (const sourceFile of typeScriptFiles(managementRoot)) {
        for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
          expect(
            forbiddenManagementImports.some(
              (forbiddenImport) =>
                specifier === forbiddenImport || specifier.startsWith(`${forbiddenImport}/`)
            ),
            `${normalize(sourceFile)} must keep generic management storage- and runtime-neutral`
          ).toBe(false);
        }
      }
    }
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
      join(compositionSource, 'index.ts'),
      join(compositionSource, 'runtime', 'index.ts'),
      join(compositionSource, 'runtime', 'types.ts'),
      join(compositionSource, 'runtime', 'provider-contracts.ts'),
      join(compositionSource, 'runtime', 'deterministic-provider-contracts.ts'),
      ...typeScriptFiles(join(compositionSource, 'management')),
    ]) {
      const source = readFileSync(publicContractFile, 'utf8');
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
