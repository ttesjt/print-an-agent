import type { MemoryReceipt, MutationRequest } from '../types/receipt.js';
import { ContextMemoryError } from '../errors.js';
import { requestDigest } from './request.js';

export function assertReceiptMatches(receipt: MemoryReceipt, request: MutationRequest): void {
  if (
    receipt.memoryId !== request.memoryId ||
    receipt.requestId !== request.requestId ||
    receipt.operation !== request.operation ||
    receipt.inputDigest !== requestDigest(request)
  ) {
    throw new ContextMemoryError(
      'REQUEST_CONFLICT',
      'Request identity was already used with different business input.',
      { memoryId: request.memoryId, commit: { status: 'not-committed' } }
    );
  }
}
