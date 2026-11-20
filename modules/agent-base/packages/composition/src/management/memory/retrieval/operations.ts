import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  assertNotAborted,
  assertReceiptMatches,
  defineRetrievalPolicy,
  findRetrievalCommit,
  parseMutation,
  parseRetrievalReceipt,
  RetrievalMemoryError,
  type CommitEvidence,
  type Mutation,
  type RetrievalMutationOutcome,
  type RetrievalReceipt,
} from '@print-an-agent/retrieval-memory';
import { MemoryManagementError } from '../errors.js';
import { validateMemoryIdentifier } from '../identity.js';
import { memoryManagementInput, memoryManagementOptions } from '../input.js';
import type { MemoryManagementOptions } from '../types/provisioning.js';
import type { AgentMemoryReference, ManagedMemoryResult } from '../types/reference.js';
import { retrievalDomainError, validateRetrievalResult } from './result-validation.js';
import type { RetrievalMemoryManagementContext } from './types/context.js';
import type {
  RetrievalMemoryManagementCapability,
  RetrievalMemoryManagementInputs,
  RetrievalMemoryManagementOutputs,
  RetrievalMemoryManagementService,
} from './types/operations.js';

type Operation = Exclude<keyof RetrievalMemoryManagementInputs, 'replay'>;
interface Recovery<I, O> {
  request(input: I): Mutation;
  result(receipt: RetrievalReceipt): O;
}
const recoveredMutation = (receipt: RetrievalReceipt): RetrievalMutationOutcome => ({
  status: receipt.outcome,
  receipt,
});
// Evidence matching imposes no second business limit on a configured Profile's valid request.
const evidencePolicy = defineRetrievalPolicy({ maxIdBytes: null, maxEntryCodepoints: null });
export function createRetrievalMemoryOperations<N>(
  definition: RetrievalMemoryManagementContext<N>,
  factories: RetrievalMemoryManagementCapability<N>['retrievalMemoryManagement']['resolve']
): RetrievalMemoryManagementService {
  async function run<K extends Operation>(
    operation: K,
    value: RetrievalMemoryManagementInputs[K] & { readonly agentId: string },
    call?: MemoryManagementOptions,
    recovery?: Recovery<RetrievalMemoryManagementInputs[K], RetrievalMemoryManagementOutputs[K]>
  ): Promise<ManagedMemoryResult<RetrievalMemoryManagementOutputs[K]>> {
    let target: AgentMemoryReference | undefined;
    let nativeId: string | undefined;
    let request: Mutation | undefined;
    let known: RetrievalReceipt | undefined;
    let requestId: string | undefined;
    let signal: AbortSignal | undefined;
    let dispatched = false;
    try {
      const options = memoryManagementOptions(call);
      signal = options.signal;
      const normalized = memoryManagementInput(value);
      target = normalized.target;
      const input = normalized.input;
      requestId = 'requestId' in input ? input.requestId : undefined;
      request = recovery?.request(input);
      assertNotAborted(signal);
      const namespace = await definition.namespace.port.resolve(parseAgentId(target.agentId));
      assertNotAborted(signal);
      if (namespace === undefined)
        throw new MemoryManagementError('MEMORY_AGENT_NOT_FOUND', target);
      if (namespace.phase !== 'published' || namespace.agentId !== target.agentId)
        throw new MemoryManagementError('MEMORY_OPERATION_FAILED', target);

      const accept = (value: unknown): RetrievalReceipt => {
        const receipt = parseRetrievalReceipt(value);
        if (receipt.memoryId !== nativeId || receipt.requestId !== requestId)
          throw new RetrievalMemoryError('STORAGE_FAILED', 'Retrieval receipt scope mismatch.');
        if (request !== undefined)
          assertReceiptMatches(
            receipt,
            parseMutation(
              request.operation,
              { ...request.input, memoryId: nativeId },
              evidencePolicy
            )
          );
        known = receipt;
        return receipt;
      };
      if (request !== undefined && recovery !== undefined) {
        const replay = await factories.replay({ namespace, input: request }, options);
        nativeId = validateMemoryIdentifier(replay.memoryId);
        assertNotAborted(signal);
        const receipt = await replay.invoke(signal);
        if (receipt !== undefined) {
          const matched = accept(receipt);
          return Object.freeze({ target, value: recovery.result(structuredClone(matched)) });
        }
      }
      assertNotAborted(signal);
      const invocation = await factories[operation]({ namespace, input }, options);
      const resolvedId = validateMemoryIdentifier(invocation.memoryId);
      if (nativeId !== undefined && resolvedId !== nativeId)
        throw new RetrievalMemoryError('STORAGE_FAILED', 'Retrieval provisioning target changed.');
      nativeId = resolvedId;
      assertNotAborted(signal);
      dispatched = true;
      const result = await invocation.invoke(signal);
      validateRetrievalResult(
        operation,
        result,
        nativeId,
        'entryId' in input ? input.entryId : undefined,
        accept
      );
      return Object.freeze({ target, value: structuredClone(result) });
    } catch (cause) {
      const error = retrievalDomainError(cause);
      const found = findRetrievalCommit(cause, (evidence) => {
        if (evidence.status === 'not-committed') return recovery !== undefined;
        if (nativeId === undefined || requestId === undefined) return false;
        if (evidence.status === 'unknown')
          return evidence.memoryId === nativeId && evidence.requestId === requestId;
        try {
          const receipt = parseRetrievalReceipt(evidence.receipt);
          if (receipt.memoryId !== nativeId || receipt.requestId !== requestId) return false;
          if (request !== undefined)
            assertReceiptMatches(
              receipt,
              parseMutation(
                request.operation,
                { ...request.input, memoryId: nativeId },
                evidencePolicy
              )
            );
          return true;
        } catch {
          return false;
        }
      });
      const commit: CommitEvidence | undefined =
        known !== undefined
          ? { status: 'committed', receipt: known }
          : found?.status === 'committed'
            ? { status: 'committed', receipt: parseRetrievalReceipt(found.receipt) }
            : (found ??
              (recovery === undefined
                ? undefined
                : dispatched && nativeId !== undefined && requestId !== undefined
                  ? { status: 'unknown', memoryId: nativeId, requestId }
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
          domain: 'retrieval',
          code: error?.code ?? (cancelled ? 'OPERATION_ABORTED' : 'STORAGE_FAILED'),
          ...(commit === undefined ? {} : { commit }),
        },
        { cause }
      );
    }
  }

  return Object.freeze({
    inspect: (input, options) => run('inspect', input, options),
    get: (input, options) => run('get', input, options),
    getReceipt: (input, options) => run('getReceipt', input, options),
    list: (input, options) => run('list', input, options),
    search: (input, options) => run('search', input, options),
    readContext: (input, options) => run('readContext', input, options),
    create: (input, options) =>
      run('create', input, options, {
        request: (input) => ({ operation: 'create', input }),
        result: recoveredMutation,
      }),
    ingest: (input, options) =>
      run('ingest', input, options, {
        request: (input) => ({ operation: 'ingest', input }),
        result: recoveredMutation,
      }),
    update: (input, options) =>
      run('update', input, options, {
        request: (input) => ({ operation: 'update', input }),
        result: recoveredMutation,
      }),
    remove: (input, options) =>
      run('remove', input, options, {
        request: (input) => ({ operation: 'remove', input }),
        result: recoveredMutation,
      }),
    reindex: (input, options) =>
      run('reindex', input, options, {
        request: (input) => ({ operation: 'reindex', input }),
        result: recoveredMutation,
      }),
  } satisfies RetrievalMemoryManagementService);
}
