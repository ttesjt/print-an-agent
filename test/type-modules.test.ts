import { expect, it } from 'vitest';
import { inspectTypeModules } from '../tooling/architecture/type-modules.js';

it.each([
  ['types.ts', 'export type Name = string;', true],
  ['feature/types/ports.ts', 'export interface Port { read(): Promise<void> }', true],
  [
    'feature/types/identity.ts',
    "declare const brand: unique symbol; export type Id = string & { readonly [brand]: 'Id' };",
    true,
  ],
  ['types.ts', "import type { Port } from './ports.js'; export type { Port };", true],
  ['types.ts', 'export const DEFAULT = 1;', false],
  ['types.ts', 'export class Runtime {}', false],
  ['types.ts', 'export function run() {}', false],
  ['types.ts', 'export enum Choice { A }', false],
  ['types.ts', "import './side-effect.js'; export type Name = string;", false],
  ['types.ts', "import { type Port } from './ports.js'; export type { Port };", false],
  [
    'schema.ts',
    'export const options = [1, 2] as const; export type Option = typeof options[number];',
    true,
  ],
])('checks runtime erasure at %s for %s', (path, source, valid) => {
  const result = inspectTypeModules([{ path, source }]);
  if (valid) expect(result).toEqual([]);
  else {
    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe(path);
    expect(result[0]?.emittedCode.length).toBeGreaterThan(0);
  }
});
