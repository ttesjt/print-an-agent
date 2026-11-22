import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';

it('emits SQLite consumer declarations without private package paths', () => {
  const source = fileURLToPath(new URL('./types/sqlite-contracts.ts', import.meta.url));
  const root = dirname(dirname(source));
  const configFile = join(root, '../tsconfig.json');
  const config = ts.readConfigFile(configFile, (path) => ts.sys.readFile(path));
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configFile));
  expect(parsed.errors).toEqual([]);
  const program = ts.createProgram([source], {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    declarationMap: false,
    emitDeclarationOnly: true,
    rootDir: dirname(source),
    outDir: join(root, '../temp/consumer-declarations'),
  });
  const declarations: string[] = [];
  // Keep generated artifacts in memory; the actual compiler still resolves public package exports.
  const emitted = program.emit(undefined, (_file, text) => declarations.push(text));
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
  expect(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  ).toEqual([]);
  expect(emitted.emitSkipped).toBe(false);
  expect(declarations).toHaveLength(1);
  expect(declarations[0]).toContain('@print-an-agent/context-memory-sqlite');
  expect(declarations[0]).not.toMatch(/node_modules|\/dist\/|import\(["']\./u);
});
