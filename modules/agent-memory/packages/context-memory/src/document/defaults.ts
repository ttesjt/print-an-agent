import { DEFAULT_COMPACTION_TARGET } from '../budget/index.js';

export const DEFAULT_MEMORY_OPTIONS = Object.freeze({
  maxContextTokens: 4096,
  maxItems: null,
  maxItemTokens: null,
  render: Object.freeze({ format: 'text' as const, separator: '\n' }),
  compactionTarget: DEFAULT_COMPACTION_TARGET,
});
