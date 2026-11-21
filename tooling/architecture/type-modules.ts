import ts from 'typescript';
import type { SourceModule } from './source-boundaries.js';

export interface TypeModuleViolation {
  readonly file: string;
  readonly emittedCode: string;
}

/** Inspect supplied type responsibility modules; the compiler still owns type correctness. */
export function inspectTypeModules(
  modules: readonly SourceModule[]
): readonly TypeModuleViolation[] {
  const violations: TypeModuleViolation[] = [];
  for (const module of modules) {
    if (!/(^|\/)types(\/|\.ts$)/.test(module.path)) continue;
    const output = ts.transpileModule(module.source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true,
        removeComments: true,
      },
    }).outputText;
    const emittedCode = output.replace(/export\s*\{\s*\};?/g, '').trim();
    if (emittedCode !== '') violations.push({ file: module.path, emittedCode });
  }
  return violations;
}
