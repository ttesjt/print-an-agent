export const ModelOperationKind = {
  Initialization: 'initialization',
  Training: 'training',
  Export: 'export',
} as const;

export type ModelOperationKind = (typeof ModelOperationKind)[keyof typeof ModelOperationKind];

export const ModelRunStatus = {
  Starting: 'starting',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Lost: 'lost',
} as const;

export type ModelRunStatus = (typeof ModelRunStatus)[keyof typeof ModelRunStatus];

export const ModelRecordKind = {
  Run: 'model-run',
} as const;

export type ModelRecordKind = (typeof ModelRecordKind)[keyof typeof ModelRecordKind];

export const ModelRunResultKind = {
  Base: 'base',
  Modification: 'modification',
  Output: 'output',
} as const;

export type ModelRunResultKind = (typeof ModelRunResultKind)[keyof typeof ModelRunResultKind];
