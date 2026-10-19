import type { MemoryConfig } from '../contracts/document.js';
import type { CompactionTarget } from '../contracts/inputs.js';
import { resolveCompactionTarget } from '../config/target.js';
import { equalValue } from '../domain/digest.js';

export interface MemoryBudgetTarget {
  readonly config: MemoryConfig;
  readonly maxTokens: number;
}
export function resolveMemoryBudgetTarget(
  config: MemoryConfig,
  target?: CompactionTarget
): MemoryBudgetTarget {
  const specification: CompactionTarget = target ?? config.compactionTarget;
  const { render, measurementRef, ...tokens } = specification;
  const view = {
    ...config,
    render: render ?? config.render,
    measurementRef: measurementRef ?? config.measurementRef,
  };
  const sameView =
    view.measurementRef === config.measurementRef && equalValue(view.render, config.render);
  const effective = sameView ? config : { ...config, maxContextTokens: null };
  const spec =
    'maxTokens' in tokens
      ? tokens
      : {
          ...tokens,
          ...(!('limitTokens' in tokens) && config.maxContextTokens !== null
            ? { limitTokens: config.maxContextTokens }
            : {}),
        };
  return { config: view, maxTokens: resolveCompactionTarget(effective, spec) };
}
