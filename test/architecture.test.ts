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
  'model-invocation': {
    packagePrefix: '@print-an-agent/model-invocation-',
    forbiddenPrefixes: [
      '@print-an-agent/base-',
      '@print-an-agent/workbench-',
      '@print-an-agent/self-learn-',
      '@print-an-agent/ui-',
      '@print-an-agent/workflow-',
    ],
  },
  workflow: {
    packagePrefix: '@print-an-agent/workflow-',
    forbiddenPrefixes: [
      '@print-an-agent/base-',
      '@print-an-agent/model-invocation-',
      '@print-an-agent/workbench-',
      '@print-an-agent/self-learn-',
      '@print-an-agent/ui-',
    ],
  },
  'model-workbench': {
    packagePrefix: '@print-an-agent/workbench-',
    forbiddenPrefixes: ['@print-an-agent/base-', '@print-an-agent/self-learn-'],
  },
  'agent-base': {
    packagePrefix: '@print-an-agent/base-',
    forbiddenPrefixes: ['@print-an-agent/workbench-', '@print-an-agent/self-learn-'],
  },
  'agent-ui': {
    packagePrefix: '@print-an-agent/ui-',
    forbiddenPrefixes: ['@print-an-agent/workbench-', '@print-an-agent/self-learn-'],
  },
});

type ModuleName = keyof typeof moduleRules;

interface PackageManifest {
  readonly name?: string;
  readonly scripts?: Readonly<Record<string, string>>;
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

function productionDependencies(manifest: PackageManifest): readonly string[] {
  return [
    ...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]),
  ].sort();
}

function declaredPeerDependencies(manifest: PackageManifest): readonly string[] {
  return Object.keys(manifest.peerDependencies ?? {}).sort();
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
  it('keeps Sessionless request implementation free of Agent owners and concrete persistence', () => {
    const requestRoot = join(repositoryRoot, 'modules/agent-base/packages/request/src');
    const files = typeScriptFiles(join(requestRoot, 'sessionless'));
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [
      '@print-an-agent/base-runtime',
      '@print-an-agent/base-session',
      '@print-an-agent/base-local-adapters',
      '@print-an-agent/base-identity',
      '@print-an-agent/model-invocation-pi',
      'node:fs',
      'node:sqlite',
    ];
    for (const file of files) {
      for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
        expect(
          forbidden.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`)),
          `${file}: ${specifier}`
        ).toBe(false);
        const target = resolveSourceModuleTarget(file, specifier);
        if (target !== undefined)
          expect(isPathWithin(target, join(requestRoot, 'default')), `${file}: ${specifier}`).toBe(
            false
          );
      }
    }
  });
  it('recognizes static, side-effect, re-export, and dynamic module specifiers', () => {
    expect(
      [
        ...moduleSpecifiers(`
        import 'side-effect-package';
        import value from 'default-package';
        import type { Contract } from "type-package";
        export { helper } from 're-export-package';
        const lazyModule = import('dynamic-package');
      `),
      ].sort()
    ).toEqual([
      'default-package',
      'dynamic-package',
      're-export-package',
      'side-effect-package',
      'type-package',
    ]);
  });

  for (const [moduleName, rule] of Object.entries(moduleRules) as Array<
    [ModuleName, (typeof moduleRules)[ModuleName]]
  >) {
    it(`${moduleName} is an explicit repository capsule`, () => {
      const moduleRoot = join(repositoryRoot, 'modules', moduleName);
      expect(existsSync(join(moduleRoot, 'README.md'))).toBe(true);
      const requiredDirectories =
        moduleName === 'model-invocation'
          ? ['docs', 'packages', 'tests']
          : ['apps', 'configs', 'docs', 'packages', 'tests'];
      for (const requiredDirectory of requiredDirectories) {
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

  it('isolates exact Pi dependencies and imports to the independent Pi adapter', () => {
    for (const moduleName of ['agent-base', 'model-invocation']) {
      const packagesRoot = join(repositoryRoot, 'modules', moduleName, 'packages');
      for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(packagesRoot, entry.name, 'package.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
        const piDependencies = declaredDependencies(manifest).filter((dependency) =>
          dependency.startsWith('@earendil-works/pi-')
        );
        const typeboxDependency = manifest.dependencies?.typebox;

        if (manifest.name === '@print-an-agent/model-invocation-pi') {
          expect(manifest.dependencies?.['@earendil-works/pi-ai']).toBe('0.82.1');
          expect(manifest.dependencies?.['@earendil-works/pi-agent-core']).toBe('0.82.1');
          expect(piDependencies).toEqual([
            '@earendil-works/pi-agent-core',
            '@earendil-works/pi-ai',
          ]);
          expect(typeboxDependency).toBe('1.1.38');
          for (const publicSource of ['index.ts', 'types.ts']) {
            const source = readFileSync(
              join(packagesRoot, entry.name, 'src', publicSource),
              'utf8'
            );
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
      expect(declaredDependencies(manifest)).not.toContain('@print-an-agent/base-local-adapters');
      expect(
        containsTextInTypeScript(join(packageRoot, 'test'), '@print-an-agent/base-local-adapters'),
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
      '@print-an-agent/base-config',
      '@print-an-agent/base-identity',
      '@print-an-agent/base-observability',
      '@print-an-agent/base-request',
      '@print-an-agent/base-session',
      '@print-an-agent/model-invocation-core',
    ]);
  });

  it('keeps the Agent Base CLI thin over the standalone Agent package', () => {
    const cliRoot = join(repositoryRoot, 'modules', 'agent-base', 'apps', 'cli');
    const manifest = JSON.parse(
      readFileSync(join(cliRoot, 'package.json'), 'utf8')
    ) as PackageManifest;
    const agentBaseRuntimeDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith('@print-an-agent/base-')
    );

    expect(agentBaseRuntimeDependencies).toEqual(['@print-an-agent/base-standalone-agent']);
    for (const forbiddenImport of [
      '@print-an-agent/model-invocation-pi',
      '@print-an-agent/model-invocation-core',
      '@print-an-agent/base-request',
      '@print-an-agent/base-session',
      '@print-an-agent/base-composition',
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

  it('keeps cross-package Agent Base consumers on declared public entry points', () => {
    const modulesRoot = join(repositoryRoot, 'modules');
    const deepImports: string[] = [];

    for (const sourceFile of typeScriptFiles(modulesRoot)) {
      for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
        if (
          /^@print-an-agent\/base-[^/]+\//u.test(specifier) &&
          specifier !== '@print-an-agent/base-composition/resource-registry'
        ) {
          deepImports.push(`${normalize(relative(repositoryRoot, sourceFile))}: ${specifier}`);
        }
      }
    }

    expect(deepImports).toEqual([]);
  });

  it('keeps reusable Agent UI packages independent from domain runtimes', () => {
    const packagesRoot = join(repositoryRoot, 'modules', 'agent-ui', 'packages');
    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = join(packagesRoot, entry.name);
      const manifestPath = join(packageRoot, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;

      for (const dependency of declaredDependencies(manifest)) {
        expect(
          [
            '@print-an-agent/base-',
            '@print-an-agent/workbench-',
            '@print-an-agent/self-learn-',
          ].some((prefix) => dependency.startsWith(prefix)),
          `${manifest.name ?? entry.name} must not depend on a domain runtime`
        ).toBe(false);
      }

      for (const sourceFile of typeScriptFiles(join(packageRoot, 'src'))) {
        const source = readFileSync(sourceFile, 'utf8');
        expect(source, `${normalize(sourceFile)} must consume UI-owned contracts`).not.toMatch(
          /@print-an-agent\/(?:base-|workbench-|self-learn-)/u
        );
      }
    }
  });

  it('contains Agent Web backend integration within its Node application boundary', () => {
    const appSource = join(repositoryRoot, 'modules', 'agent-ui', 'apps', 'agent-web', 'src');
    for (const file of typeScriptFiles(appSource)) {
      const source = readFileSync(file, 'utf8');
      const isNode = normalize(relative(appSource, file)).startsWith('node/');
      if (!isNode)
        expect(
          source,
          `${normalize(file)} must not read server credentials or build-time environment values`
        ).not.toMatch(/\bprocess\.env\b|\bimport\.meta\.env\b/u);
      for (const specifier of moduleSpecifiers(source)) {
        if (!isNode) {
          expect(specifier, `${normalize(file)} must remain browser-safe`).not.toMatch(
            /^(?:node:|@print-an-agent\/base-|@earendil-works\/pi-)/u
          );
          if (specifier.startsWith('.')) {
            const resolvedImport = resolve(dirname(file), specifier);
            const relativeImport = relative(appSource, resolvedImport);
            expect(
              relativeImport !== '..' &&
                !relativeImport.startsWith(`..${pathSeparator}`) &&
                !isAbsolute(relativeImport),
              `${normalize(file)} must use public package exports`
            ).toBe(true);
            expect(normalize(relativeImport)).not.toMatch(/^node\//u);
          }
        }
        expect(specifier).not.toMatch(/^@print-an-agent\/base-[^/]+\//u);
        expect(specifier).not.toBe('@print-an-agent/base-observability');
        expect(specifier).not.toBe('node:sqlite');
      }
    }
  });

  it('keeps Agent Web provider selection out of the root/port CLI and deterministic Engines opt-in', () => {
    const appSource = join(repositoryRoot, 'modules', 'agent-ui', 'apps', 'agent-web', 'src');
    const host =
      readFileSync(join(appSource, 'node', 'main.ts'), 'utf8') +
      readFileSync(join(appSource, 'node', 'host-arguments.ts'), 'utf8');
    expect(host).toContain('--root');
    expect(host).toContain('--port');
    expect(host).not.toContain('--provider');
    expect(host).not.toContain('createOfflineWebEngine');
    expect(moduleSpecifiers(host)).not.toContain('./host.js');
    expect(existsSync(join(appSource, 'node', 'host.ts'))).toBe(false);
    const browser = readFileSync(join(appSource, 'application', 'browser-composition.tsx'), 'utf8');
    expect(browser).toContain("mode === 'local'");
    expect(browser).toContain("mode !== 'deterministic'");
  });

  it('keeps reusable Agent UI package roles directed and store agnostic', () => {
    const packagesRoot = join(repositoryRoot, 'modules', 'agent-ui', 'packages');
    const packageManifest = (packageName: string) =>
      JSON.parse(
        readFileSync(join(packagesRoot, packageName, 'package.json'), 'utf8')
      ) as PackageManifest;
    const contractsManifest = packageManifest('contracts');
    const reactManifest = packageManifest('react');
    const stylesManifest = packageManifest('styles');
    const workspaceManifest = packageManifest('workspace');
    expect(productionDependencies(workspaceManifest)).toEqual([
      '@print-an-agent/ui-contracts',
      '@print-an-agent/ui-react',
    ]);
    expect(declaredPeerDependencies(workspaceManifest)).toEqual(['react', 'react-dom']);
    const transportManifest = packageManifest('transport');
    expect(productionDependencies(transportManifest)).toEqual(['@print-an-agent/ui-contracts']);
    expect(declaredPeerDependencies(transportManifest)).toEqual([]);
    const transportRoot = join(packagesRoot, 'transport', 'src');
    for (const file of typeScriptFiles(transportRoot)) {
      const imports = moduleSpecifiers(readFileSync(file, 'utf8'));
      expect(
        imports.some((name) => name === 'react' || name.startsWith('@print-an-agent/ui-workspace'))
      ).toBe(false);
      if (file !== join(transportRoot, 'node.ts')) {
        expect(imports.some((name) => name.startsWith('node:') || name === './node.js')).toBe(
          false
        );
      }
      for (const name of imports.filter((name) => name.startsWith('.'))) {
        expect(normalize(relative(transportRoot, resolve(dirname(file), name)))).not.toMatch(
          /^\.\./u
        );
      }
    }
    const workspaceRoot = join(packagesRoot, 'workspace', 'src');
    for (const file of typeScriptFiles(workspaceRoot)) {
      for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
        expect(specifier).not.toMatch(/^(?:node:|@print-an-agent\/ui-transport)|\.css$/u);
        if (specifier.startsWith('.')) {
          expect(normalize(relative(workspaceRoot, resolve(dirname(file), specifier)))).not.toMatch(
            /^\.\./u
          );
        }
      }
    }

    expect(productionDependencies(contractsManifest)).toEqual([]);
    expect(declaredPeerDependencies(contractsManifest)).toEqual([]);
    expect(
      productionDependencies(reactManifest).filter(
        (dependency) => dependency !== '@print-an-agent/ui-contracts'
      )
    ).toEqual([]);
    expect(declaredPeerDependencies(reactManifest)).toEqual(['react', 'react-dom']);
    expect(productionDependencies(stylesManifest)).toEqual([]);
    expect(declaredPeerDependencies(stylesManifest)).toEqual([]);

    const contractsRoot = join(packagesRoot, 'contracts', 'src');
    for (const sourceFile of typeScriptFiles(contractsRoot)) {
      const source = readFileSync(sourceFile, 'utf8');
      expect(extname(sourceFile), `${normalize(sourceFile)} must stay framework-neutral`).toBe(
        '.ts'
      );
      expect(
        moduleSpecifiers(source).filter(
          (specifier) =>
            specifier === 'react' ||
            specifier.startsWith('react/') ||
            specifier === 'zustand' ||
            specifier.startsWith('zustand/')
        ),
        `${normalize(sourceFile)} must not depend on React or an application store`
      ).toEqual([]);
    }

    const reactRoot = join(packagesRoot, 'react', 'src');
    for (const sourceFile of typeScriptFiles(reactRoot)) {
      const source = readFileSync(sourceFile, 'utf8');
      expect(
        moduleSpecifiers(source).filter(
          (specifier) => specifier === 'zustand' || specifier.startsWith('zustand/')
        ),
        `${normalize(sourceFile)} must not depend on an application store`
      ).toEqual([]);
    }
  });

  it('keeps Agent UI application roles explicit and the Gallery on public package surfaces', () => {
    const appsRoot = join(repositoryRoot, 'modules', 'agent-ui', 'apps');
    const readAppManifest = (appName: string) =>
      JSON.parse(readFileSync(join(appsRoot, appName, 'package.json'), 'utf8')) as PackageManifest;
    const agentWebManifest = readAppManifest('agent-web');
    const galleryManifest = readAppManifest('component-gallery');

    expect(agentWebManifest.name).toBe('@print-an-agent/ui-agent-web');
    expect(galleryManifest.name).toBe('@print-an-agent/ui-component-gallery');
    expect(agentWebManifest.scripts?.dev).toBe('pnpm run build:dependencies && vite');
    expect(galleryManifest.scripts?.dev).toBe('pnpm run build:dependencies && vite');
    expect(productionDependencies(galleryManifest)).toEqual([
      '@print-an-agent/ui-react',
      '@print-an-agent/ui-styles',
      'react',
      'react-dom',
    ]);
    expect(
      declaredDependencies(galleryManifest).filter((dependency) =>
        ['@print-an-agent/base-', '@print-an-agent/workbench-', '@print-an-agent/self-learn-'].some(
          (prefix) => dependency.startsWith(prefix)
        )
      )
    ).toEqual([]);

    const agentWebSourceRoot = join(appsRoot, 'agent-web', 'src');
    for (const sourceFile of typeScriptFiles(agentWebSourceRoot).filter(
      (candidate) =>
        !normalize(relative(agentWebSourceRoot, candidate)).startsWith('adapters/') &&
        ![
          'main.tsx',
          'application/browser-composition.tsx',
          'application/collection-composition.tsx',
        ].includes(normalize(relative(agentWebSourceRoot, candidate)))
    )) {
      expect(
        moduleSpecifiers(readFileSync(sourceFile, 'utf8')).filter((specifier) =>
          specifier.includes('/adapters/')
        ),
        `${normalize(sourceFile)} must depend on application ports, not deterministic adapters`
      ).toEqual([]);
    }

    const gallerySourceRoot = join(appsRoot, 'component-gallery', 'src');
    for (const sourceFile of typeScriptFiles(gallerySourceRoot)) {
      const imports = moduleSpecifiers(readFileSync(sourceFile, 'utf8'));
      expect(
        imports.filter(
          (specifier) =>
            specifier.startsWith('@print-an-agent/ui-') &&
            !['@print-an-agent/ui-react', '@print-an-agent/ui-styles/default.css'].includes(
              specifier
            )
        ),
        `${normalize(sourceFile)} must use only documented public Agent UI exports`
      ).toEqual([]);
      expect(
        imports.filter((specifier) =>
          [
            '@print-an-agent/base-',
            '@print-an-agent/workbench-',
            '@print-an-agent/self-learn-',
          ].some((prefix) => specifier.startsWith(prefix))
        ),
        `${normalize(sourceFile)} must stay independent from domain runtimes`
      ).toEqual([]);
      for (const specifier of imports.filter((candidate) => candidate.startsWith('.'))) {
        const resolvedImport = resolve(dirname(sourceFile), specifier);
        const relativeImport = relative(gallerySourceRoot, resolvedImport);
        expect(
          relativeImport !== '..' &&
            !relativeImport.startsWith(`..${pathSeparator}`) &&
            !isAbsolute(relativeImport),
          `${normalize(sourceFile)} must not escape the Gallery source root through ${specifier}`
        ).toBe(true);
      }
    }

    for (const cssFile of filesWithExtensions(gallerySourceRoot, new Set(['.css']))) {
      expect(
        readFileSync(cssFile, 'utf8'),
        `${normalize(cssFile)} must not patch reusable component hooks`
      ).not.toMatch(/\.ta-ui-(?!gallery-)/u);
    }
  });

  it('qualifies a second workspace consumer on public APIs without copying default controllers', () => {
    const uiRoot = join(repositoryRoot, 'modules', 'agent-ui');
    const fixtureRoot = join(uiRoot, 'packages', 'workspace', 'test', 'qualification');
    const fixtures = typeScriptFiles(fixtureRoot);
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    for (const file of fixtures) {
      for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.')) {
          expect(normalize(relative(fixtureRoot, resolve(dirname(file), specifier)))).not.toMatch(
            /^\.\./u
          );
        } else {
          expect([
            '@print-an-agent/ui-contracts',
            '@print-an-agent/ui-react',
            '@print-an-agent/ui-workspace',
            '@print-an-agent/ui-workspace/testing',
            'react',
            'react-dom/client',
            'vitest',
          ]).toContain(specifier);
        }
      }
    }
    const app = join(uiRoot, 'apps', 'agent-web', 'src');
    expect(typeScriptFiles(join(app, 'conversation'))).toEqual([]);
    expect(typeScriptFiles(join(app, 'session'))).toEqual([]);
    expect(readFileSync(join(app, 'app.tsx'), 'utf8')).toContain('@print-an-agent/ui-workspace');
    expect(readFileSync(join(app, 'adapters', 'http-agent-web-ports.ts'), 'utf8')).toContain(
      '@print-an-agent/ui-transport/browser'
    );
    expect(readFileSync(join(app, 'node', 'transport', 'http-server.ts'), 'utf8')).toContain(
      '@print-an-agent/ui-transport/node'
    );
  });

  it('keeps Agent UI React behavior independent from visual policy', () => {
    const reactRoot = join(repositoryRoot, 'modules', 'agent-ui', 'packages', 'react');
    const productionSource = join(reactRoot, 'src');
    const sourceFiles = typeScriptFiles(productionSource);
    const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(source).not.toMatch(/\bstyle\s*=\s*[{]/u);
    expect(source).not.toMatch(/['"][^'"]+\.css['"]/u);
    expect(
      filesWithExtensions(productionSource, new Set(['.css', '.scss', '.sass', '.less']))
    ).toEqual([]);

    const styleRoot = join(repositoryRoot, 'modules', 'agent-ui', 'packages', 'styles', 'src');
    const publicStyles = filesWithExtensions(styleRoot, new Set(['.css']))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).toContain("'ta-ui-panel'");
    for (const hook of [
      'ta-ui-panel',
      'ta-ui-button',
      'ta-ui-icon-button',
      'ta-ui-text-link',
      'ta-ui-form-field',
      'ta-ui-text-input',
      'ta-ui-textarea',
      'ta-ui-select',
      'ta-ui-checkbox',
      'ta-ui-switch',
      'ta-ui-fieldset',
      'ta-ui-badge',
      'ta-ui-status',
      'ta-ui-alert',
      'ta-ui-inline-error',
      'ta-ui-empty-state',
      'ta-ui-spinner',
      'ta-ui-skeleton',
      'ta-ui-separator',
      'ta-ui-modal-surface',
      'ta-ui-dialog',
      'ta-ui-drawer',
      'ta-ui-tabs',
      'ta-ui-tab-list',
      'ta-ui-tab',
      'ta-ui-tab-panel',
      'ta-ui-disclosure',
      'ta-ui-navigation-rail',
      'ta-ui-data-list',
      'ta-ui-agent-catalog',
      'ta-ui-agent-list',
      'ta-ui-agent-details',
      'ta-ui-agent-create-form',
      'ta-ui-agent-config-form',
      'ta-ui-config-section',
      'ta-ui-agent-lifecycle-actions',
      'ta-ui-session-catalog',
      'ta-ui-session-list',
      'ta-ui-session-details',
      'ta-ui-session-navigation',
      'ta-ui-session-branch-list',
      'ta-ui-session-rename-form',
      'ta-ui-session-lifecycle-actions',
    ]) {
      expect(source, `${hook} must be published by React`).toContain(`'${hook}'`);
      expect(publicStyles, `${hook} must be implemented by ui-styles`).toContain(`.${hook}`);
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

    expect(declaredDependencies(manifest)).not.toContain('@print-an-agent/model-invocation-pi');
    expect(
      containsTextInTypeScript(join(standaloneRoot, 'src'), '@print-an-agent/model-invocation-pi')
    ).toBe(false);
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

    expect(declaredDependencies(manifest)).not.toContain('@print-an-agent/base-standalone-agent');
    expect(
      containsTextInTypeScript(
        join(compositionRoot, 'src'),
        '@print-an-agent/base-standalone-agent'
      )
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
    expect(specifiers).toContain('./profiles/setup.js');
    expect(specifiers).not.toContain('./profiles/memory.js');
    expect(specifiers).not.toContain('./profiles/shared-sqlite.js');
    expect(specifiers).not.toContain('@print-an-agent/base-local-adapters');
    // The runtime Ports type is allowed; bootstrap must not call the materializer itself.
    expect(bootstrap).not.toContain('materializeStandaloneAgentRuntime');
    expect(bootstrap).toContain('createAgentManagementService');
    expect(bootstrap).toContain('createAgentRuntimeService');
    const materializer = readFileSync(
      join(sourceRoot, 'runtime', 'materialize-standalone-agent.ts'),
      'utf8'
    );
    expect(moduleSpecifiers(materializer)).not.toContain('@print-an-agent/base-local-adapters');
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
          (specifier) => specifier === '@print-an-agent/base-local-adapters'
        ),
        `${normalize(sourceFile)} must receive provisioned Ports instead of selecting local adapters`
      ).toBe(false);
    }

    const publicEntryPoint = readFileSync(join(sourceRoot, 'index.ts'), 'utf8');
    expect(publicEntryPoint).toMatch(/export\s*\{[^}]*\bcreateStandaloneAgent\b/u);
    expect(publicEntryPoint).toMatch(/export\s*\{[^}]*\bopenStandaloneAgent\b/u);
    expect(publicEntryPoint).toContain('createStandaloneMemorySetup');
    expect(publicEntryPoint).not.toContain('createStandaloneMemoryDefinition');
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
      rootDirectories.every((directoryName) =>
        ['runtime', 'management', 'sessionless', 'resource-registry'].includes(directoryName)
      )
    ).toBe(true);

    const rootSpecifiers = moduleSpecifiers(
      readFileSync(join(compositionSource, 'index.ts'), 'utf8')
    );
    expect(rootSpecifiers).toContain('./runtime/index.js');
    expect(
      rootSpecifiers.every((specifier) =>
        ['./runtime/index.js', './management/index.js', './sessionless/index.js'].includes(
          specifier
        )
      )
    ).toBe(true);

    const assertFeatureIsolation = (
      featureName: 'runtime' | 'management' | 'sessionless' | 'resource-registry',
      forbiddenPeer: 'runtime' | 'management' | 'sessionless' | 'resource-registry'
    ) => {
      const featureRoot = join(compositionSource, featureName);
      if (!existsSync(featureRoot)) return;
      const forbiddenPeerRoot = join(compositionSource, forbiddenPeer);
      const packageRootIndex = join(compositionSource, 'index');

      for (const sourceFile of typeScriptFiles(featureRoot)) {
        for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
          const relativeTarget = resolveSourceModuleTarget(sourceFile, specifier);
          expect(
            specifier === '@print-an-agent/base-composition' ||
              specifier.startsWith('@print-an-agent/base-composition/') ||
              relativeTarget === compositionSource ||
              relativeTarget === packageRootIndex ||
              (relativeTarget !== undefined && isPathWithin(relativeTarget, forbiddenPeerRoot)),
            `${normalize(sourceFile)} must not import the composition root or ${forbiddenPeer}/`
          ).toBe(false);
        }
      }
    };

    const features = ['runtime', 'management', 'sessionless', 'resource-registry'] as const;
    for (const feature of features) {
      for (const peer of features) {
        if (feature !== peer) assertFeatureIsolation(feature, peer);
      }
    }

    const managementRoot = join(compositionSource, 'management');
    if (existsSync(managementRoot)) {
      const forbiddenManagementImports = [
        '@print-an-agent/base-local-adapters',
        '@print-an-agent/model-invocation-pi',
        '@print-an-agent/base-standalone-agent',
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
      expect(source).not.toContain('@print-an-agent/model-invocation-pi');
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
            '@print-an-agent/model-invocation-pi',
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
      expect(dependency.startsWith('@print-an-agent/workbench-')).toBe(false);
      expect(dependency.startsWith('@print-an-agent/self-learn-')).toBe(false);
      expect(dependency.startsWith('@earendil-works/')).toBe(false);
      expect(dependency).not.toBe('typebox');
    }
    for (const sourceFile of typeScriptFiles(join(consumerRoot, 'test'))) {
      for (const specifier of moduleSpecifiers(readFileSync(sourceFile, 'utf8'))) {
        if (!specifier.startsWith('@print-an-agent/')) continue;
        expect(specifier).toMatch(
          /^@print-an-agent\/(?:(?:base-|model-invocation-)[^/]+|base-composition\/resource-registry|context-memory(?:-sqlite)?|retrieval-memory(?:-sqlite)?|workflow-(?:bundle|core))$/
        );
      }
      expect(normalize(sourceFile)).not.toContain(`${normalize('/src/')}`);
    }
  });

  it('keeps product code out of the framework workspace', () => {
    expect(existsSync(join(repositoryRoot, 'modules', 'self-learn-agent'))).toBe(false);
  });
});

function filesWithExtensions(
  directory: string,
  extensions: ReadonlySet<string>
): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return filesWithExtensions(entryPath, extensions);
    return entry.isFile() && extensions.has(extname(entry.name)) ? [entryPath] : [];
  });
}
