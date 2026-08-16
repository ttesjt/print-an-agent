export const ModelAssetKind = {
  Base: 'model-base',
} as const;

export type ModelAssetKind = (typeof ModelAssetKind)[keyof typeof ModelAssetKind];
