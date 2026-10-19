import { randomUUID } from 'node:crypto';
import type { MemoryItem, MemorySnapshot, ModelEditOperation } from '../contracts/document.js';
import type { MutationResult } from '../contracts/receipt.js';
import type { MemoryMutationResources } from './mutations.js';
import type { ModelMemoryRequest } from '../model/input.js';
import type { ModelMemoryInput, ModelMemoryOperation } from '../contracts/model.js';
import { parseModelMemoryRequest } from '../model/input.js';
import { projectModelOperations } from '../model/operations.js';
import { applyItemCommands } from './commands.js';
import { loadMemory, mutationResult, replayMutation } from './access.js';
import { publishMemoryCandidate } from './publish.js';
import { resolveMemoryBudgetTarget, type MemoryBudgetTarget } from '../planning/targets.js';
import { assessMemoryCandidate, type MemoryCandidateAssessment } from '../planning/assessment.js';
import { ContextMemoryError, assertMemoryNotAborted } from '../errors.js';

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

export interface MemoryUpdatePort {
  begin(
    operation: ModelMemoryOperation,
    input: ModelMemoryInput,
    signal: AbortSignal
  ): Promise<
    { status: 'replayed'; result: MutationResult } | { status: 'candidate'; update: MemoryUpdate }
  >;
}
export function createMemoryUpdatePort(resources: MemoryMutationResources): MemoryUpdatePort {
  return Object.freeze({
    async begin(operation: ModelMemoryOperation, input: ModelMemoryInput, signal: AbortSignal) {
      try {
        assertMemoryNotAborted(signal);
        const parsed = parseModelMemoryRequest(operation, input);
        const known = await replayMutation(resources.store, parsed.request, signal);
        if (known !== undefined)
          return { status: 'replayed' as const, result: mutationResult(known) };
        const source = await loadMemory(resources.store, parsed.request.memoryId, signal);
        const raced = await replayMutation(resources.store, parsed.request, signal);
        if (raced !== undefined)
          return { status: 'replayed' as const, result: mutationResult(raced) };
        return {
          status: 'candidate' as const,
          update: new MemoryUpdate(resources, parsed, source),
        };
      } catch (cause) {
        if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
        assertMemoryNotAborted(signal);
        throw new ContextMemoryError(
          cause instanceof ContextMemoryError ? cause.code : 'INPUT_INVALID',
          'Memory update could not be prepared.',
          { cause, commit: { status: 'not-committed' } }
        );
      }
    },
  });
}
