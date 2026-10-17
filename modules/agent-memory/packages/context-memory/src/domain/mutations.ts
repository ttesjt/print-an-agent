import { randomUUID } from 'node:crypto';
import type { MemoryConfig, MemoryConfigInput, MemoryItem } from '../contracts/document.js';
import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
} from '../contracts/inputs.js';
import type { MemoryStore } from '../contracts/ports.js';
import type {
  MutationRequest,
  MutationResult,
  MemoryOperation,
  CommandOutcome,
} from '../contracts/receipt.js';
import { resolveMemoryConfig } from '../config/parse.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../rendering/meter.js';
import { identity, jsonValue, keys, record } from '../validation/value.js';
import { parseItemCommands, parseItemContent } from '../validation/commands.js';
import { loadMutationBase, mutationResult, persistMemory, replayMutation } from './access.js';
import { assertMemoryBudget } from './budget.js';
import { applyItemCommands } from './commands.js';

export interface MemoryMutationResources {
  readonly store: MemoryStore;
  readonly meter: MemoryMeter;
  readonly defaults?: MemoryConfigInput;
  readonly createItemId?: () => string;
  /** Optional host-specific content policy; never substitutes for core validation. */
  readonly validateItem?: (item: MemoryItem, signal: AbortSignal) => void | Promise<void>;
}

/** Deterministic domain boundary. Workflows borrow it rather than a raw persistence writer. */
export class MemoryMutations {
  readonly #resources;
  constructor(resources: MemoryMutationResources) {
    this.#resources = resources;
  }

  create(input: CreateMemoryInput, signal?: AbortSignal): Promise<MutationResult> {
    return this.#run(
      'create',
      input,
      ['items', 'config'],
      async (request, data, effective) => {
        const config = resolveMemoryConfig(
          'config' in data ? data.config : {},
          this.#resources.defaults
        );
        const entries = 'items' in data ? data.items : [];
        if (!Array.isArray(entries))
          throw new ContextMemoryError('INPUT_INVALID', 'Initial items must be an array.');
        const applied = applyItemCommands(
          [],
          entries.map((item: unknown) => ({ op: 'add', ...parseItemContent(item) })),
          this.#resources.createItemId ?? randomUUID
        );
        return this.#commit(request, null, config, applied.items, [], effective);
      },
      signal
    );
  }

  apply(input: ApplyMemoryInput, signal?: AbortSignal): Promise<MutationResult> {
    return this.#run(
      'apply',
      input,
      ['expectedRevision', 'commands'],
      async (request, data, effective) => {
        const base = await loadMutationBase(
          this.#resources.store,
          request,
          data.expectedRevision,
          effective
        );
        if ('receipt' in base) return mutationResult(base.receipt);
        const { snapshot, expectedRevision: revision } = base;
        const applied = applyItemCommands(
          snapshot.items,
          parseItemCommands(data.commands),
          this.#resources.createItemId ?? randomUUID
        );
        return this.#commit(
          request,
          revision,
          snapshot.config,
          applied.items,
          applied.commandOutcomes,
          effective
        );
      },
      signal
    );
  }

  configure(input: ConfigureMemoryInput, signal?: AbortSignal): Promise<MutationResult> {
    return this.#run(
      'configure',
      input,
      ['expectedRevision', 'config'],
      async (request, data, effective) => {
        const base = await loadMutationBase(
          this.#resources.store,
          request,
          data.expectedRevision,
          effective
        );
        if ('receipt' in base) return mutationResult(base.receipt);
        const { snapshot, expectedRevision: revision } = base;
        if (!('config' in data))
          throw new ContextMemoryError('INPUT_INVALID', 'Configuration changes are required.');
        const config = resolveMemoryConfig(data.config, snapshot.config);
        return this.#commit(request, revision, config, snapshot.items, [], effective);
      },
      signal
    );
  }

  async #commit(
    request: MutationRequest,
    expectedRevision: number | null,
    config: MemoryConfig,
    items: readonly MemoryItem[],
    commandOutcomes: readonly CommandOutcome[],
    signal: AbortSignal
  ): Promise<MutationResult> {
    // All constraints are enforced here, independently of replaceable Workflow Steps.
    for (const item of items) {
      await this.#resources.validateItem?.(item, signal);
      assertMemoryNotAborted(signal);
    }
    const { measurement } = await this.#resources.meter.measure(items, config, signal);
    assertMemoryBudget(items, config, measurement);
    assertMemoryNotAborted(signal);
    return persistMemory(
      this.#resources.store,
      { request, expectedRevision, state: { config, items, measurement }, commandOutcomes },
      signal
    );
  }
  async #run(
    operation: MemoryOperation,
    input: unknown,
    fields: readonly string[],
    execute: (
      request: MutationRequest,
      data: Record<string, unknown>,
      signal: AbortSignal
    ) => Promise<MutationResult>,
    signal: AbortSignal = new AbortController().signal
  ): Promise<MutationResult> {
    let memoryId: string | undefined;
    try {
      assertMemoryNotAborted(signal);
      const data = record(jsonValue(input), 'mutation input');
      keys(data, ['memoryId', 'requestId', ...fields]);
      memoryId = identity(data.memoryId, 'memoryId');
      const requestId = identity(data.requestId, 'requestId');
      const request = {
        memoryId,
        requestId,
        operation,
        input: jsonValue(
          Object.fromEntries(
            Object.entries(data).filter(([key]) => key !== 'memoryId' && key !== 'requestId')
          )
        ),
      };
      const receipt = await replayMutation(this.#resources.store, request, signal);
      if (receipt !== undefined) return mutationResult(receipt);
      return await execute(request, data, signal);
    } catch (cause) {
      if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
      assertMemoryNotAborted(signal);
      const error =
        cause instanceof ContextMemoryError
          ? cause
          : new ContextMemoryError('INPUT_INVALID', 'Memory candidate preparation failed.', {
              cause,
            });
      throw new ContextMemoryError(error.code, error.message, {
        ...(memoryId === undefined ? {} : { memoryId }),
        details: error.details,
        cause: error,
        commit: { status: 'not-committed' },
      });
    }
  }
}
