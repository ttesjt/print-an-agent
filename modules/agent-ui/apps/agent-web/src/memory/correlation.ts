import { fail } from '@print-an-agent/ui-transport';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
/** Validate delivery identity, without guessing the Profile's native authority ID mapping. */
export function assertMemoryReply(operation: string, input: unknown, output: unknown): void {
  const request = record(input);
  if (!('agentId' in request) || !('memoryId' in request)) return;
  const response = record(output);
  if (response.status === 'failed' || response.status === 'rejected') return;
  const sameTarget = (value: unknown) => {
    const target = record(value);
    if (target.agentId !== request.agentId || target.memoryId !== request.memoryId) return fail();
  };
  if (response.status === 'indeterminate') {
    sameTarget(response.recovery);
    if (record(response.recovery).requestId !== request.requestId) return fail();
    return;
  }
  if (response.status === 'committed') {
    const value = record(response.value);
    sameTarget(value.target);
    const receipt = record(value.receipt);
    if (
      receipt.requestId !== request.requestId ||
      receipt.operation !== operation ||
      value.status !== (receipt.status ?? receipt.outcome)
    )
      return fail();
    return;
  }
  sameTarget(response.target);
  if (
    operation === 'getReceipt' &&
    response.status === 'succeeded' &&
    response.value !== null &&
    record(response.value).requestId !== request.requestId
  )
    return fail();
}
