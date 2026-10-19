import type { MemoryConfig, MemoryItem } from '../contracts/document.js';
import type { CommandOutcome, MutationRequest, MutationResult } from '../contracts/receipt.js';
import type { MemoryMutationResources } from './mutations.js';
import type { MemoryBudgetTarget } from '../planning/targets.js';
import { parseMemoryItems } from '../validation/items.js';
import { resolveMemoryConfig } from '../config/parse.js';
import { assertExactMemoryMeasurement, assertMemoryBudget } from './budget.js';
import { persistMemory } from './access.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';

/** The publication boundary revalidates actual items, not Workflow assessments or supplied counts. */
export async function publishMemoryCandidate(
  resources: MemoryMutationResources,
  request: MutationRequest,
  expectedRevision: number | null,
  configInput: MemoryConfig,
  itemsInput: readonly MemoryItem[],
  commandOutcomes: readonly CommandOutcome[],
  targets: readonly MemoryBudgetTarget[],
  signal: AbortSignal
): Promise<MutationResult> {
  const items = parseMemoryItems(itemsInput);
  const config = resolveMemoryConfig(configInput);
  for (const item of items) {
    try {
      await resources.validateItem?.(structuredClone(item), signal);
    } catch (cause) {
      assertMemoryNotAborted(signal);
      if (cause instanceof ContextMemoryError) throw cause;
      throw new ContextMemoryError('INPUT_INVALID', 'Candidate item policy rejected the update.', {
        cause,
      });
    }
    assertMemoryNotAborted(signal);
  }
  const { measurement } = await resources.meter.measure(items, config, signal);
  assertMemoryBudget(items, config, measurement);
  for (const target of targets) {
    const measured = await resources.meter.measure(items, target.config, signal);
    assertExactMemoryMeasurement(measured.measurement);
    if (measured.measurement.tokens > target.maxTokens)
      throw new ContextMemoryError('BUDGET_EXCEEDED', 'Candidate exceeds its compaction target.', {
        details: {
          actual: measured.measurement.tokens,
          limit: target.maxTokens,
          measurementRef: target.config.measurementRef,
        },
      });
  }
  assertMemoryNotAborted(signal);
  return persistMemory(
    resources.store,
    { request, expectedRevision, state: { config, items, measurement }, commandOutcomes },
    signal
  );
}
