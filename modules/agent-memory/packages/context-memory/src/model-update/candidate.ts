import { randomUUID } from 'node:crypto';
import type { MemoryItem, MemorySnapshot } from '../types/document.js';
import type { ModelEditOperation } from './types/operations.js';
import type { MutationResult } from '../types/receipt.js';
import type { MemoryMutationResources } from '../mutations/index.js';
import type { ModelMemoryRequest } from './types/request.js';
import { projectModelOperations } from './operations.js';
import { applyItemCommands } from '../document/index.js';
import { publishMemoryCandidate } from '../mutations/index.js';
import { resolveMemoryBudgetTarget, assessMemoryCandidate } from '../budget/index.js';
import type { MemoryBudgetTarget, MemoryCandidateAssessment } from '../budget/index.js';
import { ContextMemoryError } from '../errors.js';

/** Run-local candidate capability. Source/config/request are private, detached authority inputs. */
export class MemoryUpdate {
  readonly #resources;
  readonly #input;
  readonly #source;
  #items: readonly MemoryItem[];
  #target: MemoryBudgetTarget | undefined;
  #retainNonempty = false;
  constructor(
    resources: MemoryMutationResources,
    input: ModelMemoryRequest,
    source: MemorySnapshot
  ) {
    this.#resources = resources;
    this.#input = structuredClone(input);
    this.#source = structuredClone(source);
    this.#items = this.#source.items;
    if (input.request.operation === 'compact') {
      this.#target = resolveMemoryBudgetTarget(this.#source.config, input.target);
      this.#retainNonempty = this.#items.length > 0;
    }
  }
  get source(): MemorySnapshot {
    return structuredClone(this.#source);
  }
  get input(): ModelMemoryRequest {
    return structuredClone(this.#input);
  }
  get items(): readonly MemoryItem[] {
    return structuredClone(this.#items);
  }
  get targetTokens(): number | undefined {
    return this.#target?.maxTokens;
  }
  edit(operations: readonly ModelEditOperation[], compaction = false): void {
    const applied = applyItemCommands(
      this.#items,
      projectModelOperations(this.#items, operations),
      this.#resources.createItemId ?? randomUUID
    );
    if (compaction && this.#items.length > 0 && applied.items.length === 0)
      throw new ContextMemoryError(
        'MODEL_OUTPUT_INVALID',
        'Compaction cannot clear the document merely to meet its target.'
      );
    this.#items = applied.items;
  }
  async assess(signal: AbortSignal): Promise<MemoryCandidateAssessment> {
    const { config } = this.#source;
    const measured = await this.#resources.meter.measure(this.#items, config, signal);
    const base = assessMemoryCandidate(this.#items, config, measured.measurement);
    if (!base.accepted && this.#target === undefined) {
      if (config.maxContextTokens === null)
        throw new ContextMemoryError(
          'BUDGET_EXCEEDED',
          'Automatic compaction needs a configured context token target.'
        );
      this.#target = resolveMemoryBudgetTarget(config);
      this.#retainNonempty = this.#items.length > 0;
    }
    if (this.#target === undefined) return base;
    const target = await this.#resources.meter.measure(this.#items, this.#target.config, signal);
    return assessMemoryCandidate(
      this.#items,
      config,
      measured.measurement,
      this.#target,
      target.measurement
    );
  }
  async commit(signal: AbortSignal): Promise<MutationResult> {
    if (this.#retainNonempty && this.#items.length === 0)
      throw new ContextMemoryError(
        'MODEL_OUTPUT_INVALID',
        'Compaction cannot publish a forced empty document.'
      );
    return publishMemoryCandidate(
      this.#resources,
      this.#input.request,
      this.#source.revision,
      this.#source.config,
      this.#items,
      [],
      this.#target === undefined ? [] : [this.#target],
      signal
    );
  }
}
