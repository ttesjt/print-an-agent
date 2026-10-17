export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface MemoryItem {
  readonly id: string;
  readonly content: string;
  readonly metadata?: JsonObject;
}
export type ItemContent = Omit<MemoryItem, 'id'>;
export type ItemCommand =
  | (ItemContent & { readonly op: 'add' })
  | (ItemContent & { readonly op: 'replace'; readonly itemId: string })
  | { readonly op: 'remove'; readonly itemId: string };

export type ModelEditOperation =
  | { readonly op: 'add'; readonly content: string }
  | { readonly op: 'replace'; readonly itemId: string; readonly content: string }
  | { readonly op: 'remove'; readonly itemId: string };

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
  readonly tokenizerRef: string;
  readonly render: RenderOptions;
  readonly maxContextTokens: number | null;
  readonly maxItems: number | null;
  readonly maxItemTokens: number | null;
  readonly compactionTarget: TokenTarget;
}
export type MemoryConfigInput = Partial<Omit<MemoryConfig, 'render'>> & {
  readonly render?:
    | { readonly format: 'text'; readonly separator?: string }
    | Exclude<RenderOptions, { format: 'text' }>;
};

export interface ExecutionPolicy {
  readonly maxConflictRetries: number | null;
  readonly maxCompactionPasses: number | null;
  readonly retrySafetyFactor: number;
  readonly minPlannerTargetTokens: number;
  readonly maxInputTokens: number | null;
  readonly timeoutMs: number | null;
}

export interface ItemTokenCount {
  readonly itemId: string;
  readonly contentDigest: string;
  readonly tokenCount: number;
}
export interface MemoryMeasurement {
  readonly tokenizerRef: string;
  readonly rendererRef: string;
  readonly renderDigest: string;
  readonly itemsDigest: string;
  readonly tokenCount: number;
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
