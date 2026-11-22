import type { JsonValue } from '@print-an-agent/context-memory';

export type Path = readonly (string | number)[];

export type StatePatch =
  | { readonly op: 'set'; readonly path: Path; readonly value: JsonValue }
  | { readonly op: 'remove'; readonly path: Path }
  | { readonly op: 'resize'; readonly path: Path; readonly length: number }
  | {
      readonly op: 'text';
      readonly path: Path;
      readonly start: number;
      readonly deleteCount: number;
      readonly text: string;
    };
