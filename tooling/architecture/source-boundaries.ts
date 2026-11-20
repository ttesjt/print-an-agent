import { posix } from 'node:path';
import ts from 'typescript';

export interface SourceBoundary {
  /** Source-root-relative directory, or an empty string for the enclosing package. */
  readonly directory: string;
  /** Public files relative to this boundary, including explicitly exposed child subentries. */
  readonly entries: readonly string[];
  /** Contracts/capabilities descendants may consume without entering the aggregate API. */
  readonly sharedEntries?: readonly string[];
}

export interface SourceDependencyRule {
  /** A source-root-relative file or directory. */
  readonly scope: string;
  readonly dependencies: readonly string[];
}

export interface SourceModule {
  /** POSIX path relative to the checked source root. */
  readonly path: string;
  readonly source: string;
}

export interface SourceBoundaryViolation {
  readonly file: string;
  readonly target: string;
  readonly rule:
    | 'private-entry'
    | 'ancestor-entry'
    | 'aggregate-import'
    | 'dependency'
    | 'wildcard';
}

function contains(scope: string, file: string): boolean {
  return scope === '' || file === scope || file.startsWith(`${scope}/`);
}

function owner(file: string, boundaries: readonly SourceBoundary[]): SourceBoundary | undefined {
  return boundaries
    .filter((boundary) => contains(boundary.directory, file))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
}

/** Inspect literal ESM imports, re-exports, import types and dynamic imports, including type edges. */
function moduleSpecifiers(source: ts.SourceFile): readonly string[] {
  const specifiers = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) specifiers.add(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...specifiers];
}

/** Opt-in source checks. Computed imports, custom loaders and runtime ownership need review. */
export function inspectSourceBoundaries(
  modules: readonly SourceModule[],
  boundaries: readonly SourceBoundary[],
  dependencyRules: readonly SourceDependencyRule[] = []
): readonly SourceBoundaryViolation[] {
  const violations: SourceBoundaryViolation[] = [];
  for (const module of modules) {
    const source = ts.createSourceFile(module.path, module.source, ts.ScriptTarget.Latest, true);
    const sourceOwner = owner(module.path, boundaries);
    for (const statement of source.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause))
      )
        violations.push({ file: module.path, target: statement.getText(source), rule: 'wildcard' });
    }
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = posix
        .normalize(posix.join(posix.dirname(module.path), specifier))
        .replace(/\.js$/u, '.ts');
      if (target.startsWith('../')) continue;
      const targetOwner = owner(target, boundaries);
      for (const boundary of boundaries) {
        if (contains(boundary.directory, module.path) || !contains(boundary.directory, target))
          continue;
        if (!boundary.entries.includes(posix.relative(boundary.directory, target)))
          violations.push({ file: module.path, target, rule: 'private-entry' });
      }
      if (sourceOwner !== undefined && targetOwner !== undefined) {
        const entry = posix.relative(targetOwner.directory, target);
        if (
          sourceOwner !== targetOwner &&
          contains(targetOwner.directory, sourceOwner.directory) &&
          !targetOwner.sharedEntries?.includes(entry)
        ) {
          violations.push({ file: module.path, target, rule: 'ancestor-entry' });
        }
        if (sourceOwner === targetOwner && entry === 'index.ts' && module.path !== target)
          violations.push({ file: module.path, target, rule: 'aggregate-import' });
      }
      for (const rule of dependencyRules) {
        if (
          contains(rule.scope, module.path) &&
          !contains(rule.scope, target) &&
          !rule.dependencies.some((scope) => contains(scope, target))
        ) {
          violations.push({ file: module.path, target, rule: 'dependency' });
        }
      }
    }
  }
  return violations;
}
