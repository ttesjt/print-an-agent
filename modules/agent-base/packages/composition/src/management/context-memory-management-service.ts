import { parseAgentId } from '@print-an-agent/base-identity';
import {
  assertMemoryNotAborted,
  assertReceiptMatches,
  ContextMemoryError,
  findContextMemoryCommit,
  parseDeterministicMemoryRequest,
  parseMemoryReceipt,
  parseMemorySnapshot,
  type CommitStatus,
  type MemoryReceipt,
  type MutationResult,
} from '@print-an-agent/context-memory';
import type {
  AgentMemoryReference,
  ContextMemoryManagementCapability,
  ContextMemoryManagementInputs,
  ContextMemoryManagementOutputs,
  ContextMemoryManagementService,
  ContextMemoryReplayInput,
  ManagedMemoryResult,
  MemoryManagementOptions,
} from './contracts/memory.js';
import type { ManagedAgentNamespacePort } from './contracts/namespace.js';
import { MemoryManagementError } from './memory-errors.js';
import { memoryManagementInput, memoryManagementOptions } from './memory-input.js';
import { validateMemoryIdentifier } from './memory-target.js';

type Definition<N> = {
  readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
} & Partial<ContextMemoryManagementCapability<N>>;
type Operation = Exclude<keyof ContextMemoryManagementInputs, 'replay'>;
interface Recovery<I, O> {
  request(input: I): ContextMemoryReplayInput;
  result(receipt: MemoryReceipt): O;
}
function domainError(error: unknown): ContextMemoryError | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let first: ContextMemoryError | undefined;
  while (pending.length !== 0) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    if (cause instanceof ContextMemoryError) {
      first ??= cause;
      // Cleanup failure is independent of cancellation and of the business commit status.
      if (cause.code === 'CLEANUP_FAILED') return cause;
    }
    const children: unknown[] =
      cause instanceof AggregateError
        ? [...(cause.errors as unknown[]), cause.cause]
        : [cause.cause];
    pending.push(...children.reverse());
  }
  return first;
}
function safeDetails(error?: ContextMemoryError): Readonly<Record<string, string | number>> {
  const details: Record<string, string | number> = {};
  if (error?.code !== 'BUDGET_EXCEEDED' && error?.code !== 'REVISION_CONFLICT') return details;
  for (const name of ['actual', 'limit', 'expectedRevision', 'actualRevision']) {
    const value = error?.details[name];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      details[name] = value;
  }
  for (const name of ['kind', 'measurementRef', 'rendererRef']) {
    const value = error?.details[name];
    if (typeof value === 'string' && value.isWellFormed() && value.length <= 1024)
      details[name] = value;
  }
  return Object.freeze(details);
}
const recoveredMutation = (receipt: MemoryReceipt): MutationResult => ({
  status: receipt.status,
  receipt,
});

/** Known absent capabilities are a type error. Optional Profile capabilities are checked at creation. */
export function createContextMemoryManagementService<N>(
  definition: {
    readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
  } & ContextMemoryManagementCapability<N>
): ContextMemoryManagementService;
export function createContextMemoryManagementService<N, const D extends object>(
  definition: Definition<N> &
    D &
    Readonly<Record<Exclude<'contextMemoryManagement', keyof D>, never>>
): ContextMemoryManagementService;
export function createContextMemoryManagementService<N>(
  definition: Definition<N>
): ContextMemoryManagementService {
  const capability = definition.contextMemoryManagement;
  if (
    capability === undefined ||
    capability === null ||
    typeof capability.resolve !== 'object' ||
    capability.resolve === null ||
    ['inspect', 'getReceipt', 'replay', 'create', 'apply', 'configure', 'readContext'].some(
      (key) => typeof Reflect.get(capability.resolve, key) !== 'function'
    )
  )
    throw new MemoryManagementError('MEMORY_CAPABILITY_UNAVAILABLE', undefined);
  const factories = capability.resolve;

  async function run<K extends Operation>(
    operation: K,
    value: ContextMemoryManagementInputs[K] & { readonly agentId: string },
    call?: MemoryManagementOptions,
    recovery?: Recovery<ContextMemoryManagementInputs[K], ContextMemoryManagementOutputs[K]>
  ): Promise<ManagedMemoryResult<ContextMemoryManagementOutputs[K]>> {
    let target: AgentMemoryReference | undefined;
    let nativeId: string | undefined;
    let request: ContextMemoryReplayInput | undefined;
    let known: MemoryReceipt | undefined;
    let dispatched = false;
    let requestId: string | undefined;
    let signal: AbortSignal | undefined;
    try {
      const options = memoryManagementOptions(call);
      signal = options.signal;
      const normalized = memoryManagementInput(value);
      target = normalized.target;
      const input = normalized.input;
      requestId =
        'requestId' in input && typeof input.requestId === 'string' ? input.requestId : undefined;
      request = recovery?.request(input);
      assertMemoryNotAborted(signal);
      const namespace = await definition.namespace.port.resolve(parseAgentId(target.agentId));
      assertMemoryNotAborted(signal);
      if (namespace === undefined)
        throw new MemoryManagementError('MEMORY_AGENT_NOT_FOUND', target);
      if (namespace.phase !== 'published' || namespace.agentId !== target.agentId)
        throw new MemoryManagementError('MEMORY_OPERATION_FAILED', target);

      function accept(receipt: MemoryReceipt, id: string): MemoryReceipt {
        const parsed = parseMemoryReceipt(receipt);
        if (
          parsed.memoryId !== id ||
          ('requestId' in input && parsed.requestId !== input.requestId)
        )
          throw new ContextMemoryError('STORAGE_FAILED', 'Memory receipt scope mismatch.');
        if (request !== undefined)
          assertReceiptMatches(
            parsed,
            parseDeterministicMemoryRequest(request.operation, { ...request.input, memoryId: id })
              .request
          );
        return parsed;
      }
      if (recovery !== undefined && request !== undefined) {
        const replay = await factories.replay({ namespace, input: request }, options);
        nativeId = validateMemoryIdentifier(replay.memoryId);
        assertMemoryNotAborted(signal);
        const receipt = await replay.invoke(signal);
        if (receipt !== undefined) {
          known = accept(receipt, nativeId);
          // No cancellation check may override an established durable fact.
          return Object.freeze({ target, value: recovery.result(structuredClone(known)) });
        }
      }
      assertMemoryNotAborted(signal);
      const invocation = await factories[operation]({ namespace, input }, options);
      const resolvedId = validateMemoryIdentifier(invocation.memoryId);
      if (nativeId !== undefined && nativeId !== resolvedId)
        throw new ContextMemoryError('STORAGE_FAILED', 'Memory provisioning target changed.');
      nativeId = resolvedId;
      assertMemoryNotAborted(signal);
      dispatched = true;
      const result = await invocation.invoke(signal);
      if (operation === 'getReceipt' && result !== undefined)
        known = accept(parseMemoryReceipt(result), nativeId);
      if (
        operation === 'inspect' &&
        result !== undefined &&
        parseMemorySnapshot(result).memoryId !== nativeId
      )
        throw new ContextMemoryError('STORAGE_FAILED', 'Memory snapshot scope mismatch.');
      if (operation === 'readContext' && result !== undefined) {
        if (
          typeof result !== 'object' ||
          result === null ||
          !('snapshot' in result) ||
          parseMemorySnapshot(result.snapshot).memoryId !== nativeId
        )
          throw new ContextMemoryError('STORAGE_FAILED', 'Memory context scope mismatch.');
      }
      if (recovery !== undefined) {
        if (typeof result !== 'object' || result === null || !('status' in result))
          throw new ContextMemoryError('STORAGE_FAILED', 'Invalid Memory mutation result.');
        if (
          (result.status === 'committed' || result.status === 'unchanged') &&
          'receipt' in result
        ) {
          known = accept(parseMemoryReceipt(result.receipt), nativeId);
          if (known.status !== result.status)
            throw new ContextMemoryError('STORAGE_FAILED', 'Invalid Memory mutation status.');
        } else if (
          result.status !== 'skipped' ||
          !('reason' in result) ||
          typeof result.reason !== 'string'
        )
          throw new ContextMemoryError('STORAGE_FAILED', 'Invalid Memory mutation result.');
      }
      return Object.freeze({ target, value: structuredClone(result) });
    } catch (cause) {
      const error = domainError(cause);
      // Validate every candidate before selection, including evidence nested under foreign receipts.
      const found = findContextMemoryCommit(cause, (evidence) => {
        if (evidence.status === 'not-committed') return recovery !== undefined;
        if (nativeId === undefined || requestId === undefined) return false;
        if (evidence.status === 'unknown')
          return evidence.memoryId === nativeId && evidence.requestId === requestId;
        try {
          const receipt = parseMemoryReceipt(evidence.receipt);
          if (receipt.memoryId !== nativeId || receipt.requestId !== requestId) return false;
          if (request !== undefined)
            assertReceiptMatches(
              receipt,
              parseDeterministicMemoryRequest(request.operation, {
                ...request.input,
                memoryId: nativeId,
              }).request
            );
          return true;
        } catch {
          return false;
        }
      });
      const commit: CommitStatus | undefined =
        known !== undefined
          ? { status: 'committed', receipt: known }
          : found?.status === 'committed'
            ? { status: 'committed', receipt: parseMemoryReceipt(found.receipt) }
            : (found ??
              (recovery === undefined
                ? undefined
                : dispatched && nativeId !== undefined && request !== undefined
                  ? { status: 'unknown', memoryId: nativeId, requestId: request.input.requestId }
                  : { status: 'not-committed' }));
      const cancelled =
        error?.code !== 'CLEANUP_FAILED' &&
        (signal?.aborted === true || error?.code === 'OPERATION_ABORTED') &&
        commit?.status !== 'committed' &&
        commit?.status !== 'unknown';
      throw new MemoryManagementError(
        error?.code === 'CLEANUP_FAILED'
          ? 'MEMORY_OPERATION_FAILED'
          : cause instanceof MemoryManagementError
            ? cause.code
            : cancelled
              ? 'MEMORY_OPERATION_ABORTED'
              : 'MEMORY_OPERATION_FAILED',
        target,
        {
          domain: 'context',
          code: error?.code ?? (cancelled ? 'OPERATION_ABORTED' : 'STORAGE_FAILED'),
          ...(commit === undefined ? {} : { commit }),
          details: safeDetails(error),
        },
        { cause }
      );
    }
  }
  return Object.freeze({
    inspect: (input, options) => run('inspect', input, options),
    getReceipt: (input, options) => run('getReceipt', input, options),
    readContext: (input, options) => run('readContext', input, options),
    create: (input, options) =>
      run('create', input, options, {
        request: (input) => ({ operation: 'create', input }),
        result: recoveredMutation,
      }),
    apply: (input, options) =>
      run('apply', input, options, {
        request: (input) => ({ operation: 'apply', input }),
        result: recoveredMutation,
      }),
    configure: (input, options) =>
      run('configure', input, options, {
        request: (input) => ({ operation: 'configure', input }),
        result: recoveredMutation,
      }),
  } satisfies ContextMemoryManagementService);
}
