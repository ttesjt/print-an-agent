import { MemoryManagementError } from '@print-an-agent/base-composition';
import type { Decoder } from '@print-an-agent/ui-transport';
import type { MemoryFailure } from '../../memory/schemas/common.js';

interface Target {
  readonly agentId: string;
  readonly memoryId: string;
}
interface Request extends Target {
  readonly requestId: string;
}
function failure(cause: unknown): MemoryFailure {
  return cause instanceof MemoryManagementError
    ? {
        code: cause.code,
        message: cause.message,
        ...(cause.failure === undefined ? {} : { domainCode: cause.failure.code }),
        ...(cause.failure?.domain === 'context' && cause.failure.details !== undefined
          ? { details: cause.failure.details }
          : {}),
      }
    : { code: 'MEMORY_OPERATION_FAILED', message: 'Memory operation failed.' };
}
export async function projectMemoryRead<T, O>(
  output: Decoder<O>,
  invoke: () => Promise<{ readonly target: Target; readonly value: T }>,
  unwrap?: (value: T) => unknown
): Promise<O> {
  try {
    const result = await invoke();
    const value = unwrap === undefined ? result.value : unwrap(result.value);
    if (
      typeof value === 'object' &&
      value !== null &&
      'status' in value &&
      value.status === 'skipped' &&
      'reason' in value
    )
      return output.decode({ status: 'skipped', target: result.target, reason: value.reason });
    return output.decode({ status: 'succeeded', target: result.target, value: value ?? null });
  } catch (cause) {
    return output.decode({ status: 'failed', failure: failure(cause) });
  }
}
export function unwrapRetrieval<T>(
  value:
    | { readonly status: 'completed'; readonly value: T }
    | { readonly status: 'skipped'; readonly reason: string }
) {
  return value.status === 'completed' ? value.value : value;
}
/** A receipt query's post-processing failure cannot erase the already-read durable fact. */
export async function projectMemoryReceipt<T, O>(
  domain: 'context' | 'retrieval',
  output: Decoder<O>,
  invoke: () => Promise<{ readonly target: Target; readonly value: T }>,
  unwrap?: (value: T) => unknown
): Promise<O> {
  try {
    const result = await invoke();
    const value = unwrap === undefined ? result.value : unwrap(result.value);
    if (
      typeof value === 'object' &&
      value !== null &&
      'status' in value &&
      value.status === 'skipped' &&
      'reason' in value
    )
      return output.decode({ status: 'skipped', target: result.target, reason: value.reason });
    return output.decode({ status: 'succeeded', target: result.target, value: value ?? null });
  } catch (cause) {
    if (
      cause instanceof MemoryManagementError &&
      cause.failure?.domain === domain &&
      cause.failure.commit?.status === 'committed'
    )
      return output.decode({
        status: 'succeeded',
        target: cause.target,
        value: cause.failure.commit.receipt,
        notices: [
          {
            code: cause.failure.code,
            message: 'Receipt recovered; post-processing or cleanup failed.',
          },
        ],
      });
    return output.decode({ status: 'failed', failure: failure(cause) });
  }
}
interface NativeMutation<R> {
  readonly target: Target;
  readonly value:
    | { readonly status: 'committed' | 'unchanged'; readonly receipt: R }
    | { readonly status: 'skipped'; readonly reason: string };
}
export async function projectMemoryMutation<R, O>(
  domain: 'context' | 'retrieval',
  input: Request,
  output: Decoder<O>,
  invoke: () => Promise<NativeMutation<R>>
): Promise<O> {
  let completed: NativeMutation<R> | undefined;
  try {
    completed = await invoke();
    if (completed.value.status === 'skipped')
      return output.decode({
        status: 'skipped',
        target: completed.target,
        reason: completed.value.reason,
      });
    return output.decode({
      status: 'committed',
      value: {
        target: completed.target,
        status: completed.value.status,
        receipt: completed.value.receipt,
      },
      notices: [],
    });
  } catch (cause) {
    const detail =
      cause instanceof MemoryManagementError && cause.failure?.domain === domain
        ? cause.failure
        : undefined;
    const commit = detail?.commit;
    if (commit?.status === 'committed') {
      const status = 'status' in commit.receipt ? commit.receipt.status : commit.receipt.outcome;
      return output.decode({
        status: 'committed',
        value: {
          target: cause instanceof MemoryManagementError ? cause.target : input,
          status,
          receipt: commit.receipt,
        },
        notices: [
          {
            code: detail?.code ?? 'MEMORY_POST_PROCESSING_FAILED',
            message:
              'Memory committed, but post-processing or cleanup failed. Read the current state.',
          },
        ],
      });
    }
    if (completed === undefined && commit?.status === 'not-committed')
      return output.decode({ status: 'rejected', failure: failure(cause) });
    // Includes projection failure after a returned result and all unclassified delivery failures.
    return output.decode({
      status: 'indeterminate',
      notice: {
        code: 'MEMORY_RESULT_UNAVAILABLE',
        message: 'Read the receipt before retrying this same request.',
      },
      recovery: { agentId: input.agentId, memoryId: input.memoryId, requestId: input.requestId },
    });
  }
}
