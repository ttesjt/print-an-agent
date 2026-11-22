import type { RenderOptions, MemoryConfig } from '../../types/document.js';

export type MemoryConfigInput = Partial<Omit<MemoryConfig, 'render'>> & {
  readonly render?:
    | { readonly format: 'text'; readonly separator?: string }
    | Exclude<RenderOptions, { format: 'text' }>;
};
