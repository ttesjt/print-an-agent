import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const core = join(root, 'modules/agent-base/packages/composition');
const registry = join(core, 'src/resource-registry');
const consumerRoot = join(root, 'modules/agent-base/tests/integration');
const consumer = join(consumerRoot, 'test/resource-registry');
const eslint = new ESLint();

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

it('keeps Registry a domain-neutral Composition subsystem with a dedicated public subpath', () => {
  const manifest = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')) as {
    name: string;
    exports: Record<string, { types: string; import: string }>;
  };
  expect(manifest.name).toBe('@ta-agent/base-composition');
  expect(manifest.exports['./resource-registry']).toEqual({
    types: './dist/resource-registry/index.d.ts',
    import: './dist/resource-registry/index.js',
  });
  expect(readFileSync(join(core, 'src/index.ts'), 'utf8')).not.toContain('resource-registry');
  for (const file of sources(registry)) {
    expect(readFileSync(file, 'utf8'), file).not.toMatch(/@ta-agent\//);
    expect(readFileSync(file, 'utf8'), file).not.toMatch(
      /AsyncLocalStorage|class .*Agent|class .*Workflow/
    );
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    for (const node of tree.statements) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        expect(specifier.startsWith('.'), `${file}: ${specifier}`).toBe(true);
        expect(resolve(dirname(file), specifier).startsWith(`${registry}${sep}`)).toBe(true);
      }
    }
  }
  for (const directory of ['unit', 'types']) {
    for (const file of sources(join(core, 'test', directory, 'resource-registry')))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?:\.\.\/)+src\//);
  }
});

it('qualifies non-Agent consumers within the existing Base integration project through public exports', () => {
  const manifest = JSON.parse(readFileSync(join(consumerRoot, 'package.json'), 'utf8')) as {
    private: boolean;
    exports?: unknown;
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  expect(manifest.private).toBe(true);
  expect(manifest.exports).toBeUndefined();
  expect(manifest.dependencies ?? {}).toEqual({});
  for (const name of [
    'base-composition',
    'context-memory',
    'context-memory-sqlite',
    'retrieval-memory',
    'retrieval-memory-sqlite',
    'model-invocation-core',
    'workflow-bundle',
  ])
    expect(manifest.devDependencies[`@ta-agent/${name}`]).toBe('workspace:*');
  for (const file of sources(consumer)) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const check = (node: ts.Node): void => {
      const specifier =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : ts.isCallExpression(node) &&
              node.expression.kind === ts.SyntaxKind.ImportKeyword &&
              node.arguments[0] !== undefined &&
              ts.isStringLiteral(node.arguments[0])
            ? node.arguments[0].text
            : undefined;
      if (specifier !== undefined && !specifier.startsWith('node:')) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          expect(target.startsWith(`${consumer}${sep}`), `${file}: ${specifier}`).toBe(true);
        } else {
          const packageName = specifier
            .split('/')
            .slice(0, specifier.startsWith('@') ? 2 : 1)
            .join('/');
          expect(manifest.devDependencies, `${file}: ${specifier}`).toHaveProperty(packageName);
          if (specifier.startsWith('@ta-agent/'))
            expect(specifier).toBe(
              packageName === '@ta-agent/base-composition'
                ? '@ta-agent/base-composition/resource-registry'
                : packageName
            );
        }
      }
      ts.forEachChild(node, check);
    };
    check(tree);
  }
});

it.each([
  '@ta-agent/base-composition',
  '@ta-agent/context-memory/src/index.js',
  '@ta-agent/model-invocation-pi',
])('rejects independent consumer importing %s', async (specifier) => {
  const results = await eslint.lintText(`import '${specifier}';\n`, {
    filePath: join(consumer, 'examples/memory-composition.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});

it.each([
  '@ta-agent/base-composition',
  '@ta-agent/workflow-core',
  '@ta-agent/context-memory',
  '@ta-agent/model-invocation-core',
])('rejects domain import %s in Core', async (specifier) => {
  const results = await eslint.lintText(`import '${specifier}';\n`, {
    filePath: join(registry, 'index.ts'),
  });
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});

it.each([
  'workflow/packages/core',
  'workflow/packages/bundle',
  'agent-memory/packages/context-memory',
  'agent-memory/packages/retrieval-memory',
  'model-invocation/packages/core',
  'agent-base/packages/runtime',
  'agent-base/packages/session',
])('keeps the Registry out of neutral execution/domain package %s', async (consumer) => {
  const results = await eslint.lintText(
    "import '@ta-agent/base-composition/resource-registry';\n",
    {
      filePath: join(root, 'modules', consumer, 'src/index.ts'),
    }
  );
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});

it.each([
  'modules/agent-base/packages/composition/src/management/agent-management-service.ts',
  'modules/agent-base/packages/composition/src/runtime/index.ts',
  'modules/agent-base/packages/standalone-agent/src/services/management-service.ts',
  'modules/agent-base/packages/standalone-agent/src/runtime/materialize-standalone-agent.ts',
  'modules/agent-base/tests/integration/test/resource-registry/examples/service-provisioning/service.ts',
  'modules/agent-base/tests/integration/test/resource-registry/examples/service-provisioning/workflow.ts',
])('rejects Registry access at generic Service/Workflow boundary %s', async (file) => {
  const results = await eslint.lintText(
    "import '@ta-agent/base-composition/resource-registry';\n",
    {
      filePath: join(root, file),
    }
  );
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});

it.each([
  'modules/agent-base/packages/standalone-agent/src/resources/memory/provisioner.ts',
  'modules/agent-base/tests/integration/test/resource-registry/examples/service-provisioning/profile.ts',
])('allows a Profile resource-resolution Service to use Registry at %s', async (file) => {
  const results = await eslint.lintText(
    "import '@ta-agent/base-composition/resource-registry';\n",
    {
      filePath: join(root, file),
    }
  );
  expect(results.flatMap((result) => result.messages)).toEqual([]);
});

it.each(['../resource-registry/index.js', '../resource-registry/scope.js'])(
  'rejects relative Registry access from generic management: %s',
  async (specifier) => {
    const results = await eslint.lintText(`import '${specifier}';\n`, {
      filePath: join(core, 'src/management/agent-management-service.ts'),
    });
    expect(results.flatMap((result) => result.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
      ])
    );
  }
);

it.each([
  [
    'modules/agent-base/tests/integration/test/resource-registry/examples/service-provisioning/service.ts',
    '@ta-agent/base-composition',
  ],
  [
    'modules/agent-base/tests/integration/test/resource-registry/examples/service-provisioning/workflow.ts',
    '@ta-agent/model-invocation-pi',
  ],
  [
    'modules/agent-base/packages/composition/src/management/agent-management-service.ts',
    '@ta-agent/self-learn-application',
  ],
  [
    'modules/agent-base/packages/standalone-agent/src/services/management-service.ts',
    '@ta-agent/workbench-control-plane',
  ],
])('preserves independent-consumer/product boundaries at %s for %s', async (file, specifier) => {
  const results = await eslint.lintText(`import '${specifier}';\n`, { filePath: join(root, file) });
  expect(results.flatMap((result) => result.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: 'no-restricted-imports', severity: 2 }),
    ])
  );
});
