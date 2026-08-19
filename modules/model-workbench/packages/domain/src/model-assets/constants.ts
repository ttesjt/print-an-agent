export const ModelAssetKind = {
  Base: 'model-base',
  Modification: 'model-modification',
} as const;

export type ModelAssetKind = (typeof ModelAssetKind)[keyof typeof ModelAssetKind];

export const ModelStateKind = {
  State: 'model-state',
} as const;

export type ModelStateKind = (typeof ModelStateKind)[keyof typeof ModelStateKind];
