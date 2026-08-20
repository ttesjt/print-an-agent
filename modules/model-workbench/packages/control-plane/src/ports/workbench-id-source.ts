export const WorkbenchGeneratedIdKind = {
  Run: 'run',
  Base: 'base',
  Modification: 'modification',
  Output: 'output',
  Artifact: 'artifact',
} as const;

export type WorkbenchGeneratedIdKind =
  (typeof WorkbenchGeneratedIdKind)[keyof typeof WorkbenchGeneratedIdKind];

export interface WorkbenchIdSource {
  nextId(kind: WorkbenchGeneratedIdKind): string;
}
