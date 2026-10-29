import { randomUUID } from 'node:crypto';
import type { MemoryConfig, MemoryConfigInput, MemoryItem } from '../contracts/document.js';
import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
} from '../contracts/inputs.js';
import type { MemoryStore } from '../contracts/ports.js';
import type { MutationRequest, MutationResult, CommandOutcome } from '../contracts/receipt.js';
import { resolveMemoryConfig } from '../config/parse.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../rendering/meter.js';
import {
  parseDeterministicMemoryRequest,
  type DeterministicMemoryMutation,
} from './deterministic-request.js';
import { parseItemCommands, parseItemContent } from '../validation/commands.js';
import { loadMutationBase, mutationResult, replayMutation } from './access.js';
import { publishMemoryCandidate } from './publish.js';
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
    return publishMemoryCandidate(
      this.#resources,
      request,
      expectedRevision,
      config,
      items,
      commandOutcomes,
      [],
      signal
    );
  }
  async #run(
    operation: DeterministicMemoryMutation['operation'],
    input: unknown,
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
      const { data, request } = parseDeterministicMemoryRequest(operation, input);
      memoryId = request.memoryId;
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
