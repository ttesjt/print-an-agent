import type { TokenMeasurement } from '@print-an-agent/model-invocation-core';
import type { JsonObject } from './json.js';

export interface MemoryItem {
  readonly id: string;
  readonly content: string;
  readonly metadata?: JsonObject;
}

export type RenderOptions =
  | { readonly format: 'text'; readonly separator: string }
  | { readonly format: 'json' }
  | { readonly format: 'custom'; readonly rendererRef: string; readonly options: JsonObject };

export type TokenTarget =
  | {
      readonly maxTokens: number;
      readonly limitTokens?: never;
      readonly ratio?: never;
      readonly reserveTokens?: never;
    }
  | {
      readonly maxTokens?: never;
      readonly limitTokens?: number;
      readonly ratio?: number;
      readonly reserveTokens?: number;
    };

export interface MemoryConfig {
  readonly measurementRef: string;
  readonly render: RenderOptions;
  readonly maxContextTokens: number | null;
  readonly maxItems: number | null;
  readonly maxItemTokens: number | null;
  readonly compactionTarget: TokenTarget;
}

export interface ItemTokenCount extends TokenMeasurement {
  readonly itemId: string;
  readonly contentDigest: string;
}

export interface MemoryMeasurement extends TokenMeasurement {
  readonly rendererRef: string;
  readonly renderDigest: string;
  readonly itemsDigest: string;
  readonly itemTokenCounts: readonly ItemTokenCount[];
}

export interface MemoryState {
  readonly config: MemoryConfig;
  readonly items: readonly MemoryItem[];
  readonly measurement: MemoryMeasurement;
}

export interface MemorySnapshot extends MemoryState {
  readonly memoryId: string;
  readonly revision: number;
}
