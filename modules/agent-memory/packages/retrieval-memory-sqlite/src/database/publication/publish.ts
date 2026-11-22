import type { DatabaseSync } from 'node:sqlite';
import {
  validatePublication,
  assertReceiptMatches,
  decideRetrievalPublication,
  type RetrievalPublication,
  type RetrievalReceipt,
} from '@print-an-agent/retrieval-memory';
import { readEntry, readReceipt, readSpace } from '../persistence/index.js';
import { transaction } from '../transaction.js';
import { writeDecision } from './write-decision.js';
import { recoverCommit } from './recover-commit.js';

export function publish(
  db: DatabaseSync,
  input: RetrievalPublication,
  flag: Int32Array
): RetrievalReceipt {
  const candidate = validatePublication(input);
  const { mutation, space } = candidate;
  const { memoryId, requestId } = mutation.input;
  let recovered: RetrievalReceipt | undefined;
  try {
    return transaction(db, 'write', flag, () => {
      const receipt = readReceipt(db, memoryId, requestId);
      if (receipt !== undefined) {
        assertReceiptMatches(receipt, mutation);
        recovered = receipt;
        return receipt;
      }
      const currentSpace = readSpace(db, memoryId);
      const entryId =
        candidate.entry?.entryId ?? ('entryId' in mutation.input ? mutation.input.entryId : null);
      const current = entryId === null ? undefined : readEntry(db, memoryId, entryId, currentSpace);
      const decision = decideRetrievalPublication(currentSpace, current, receipt, candidate);
      if (!('space' in decision)) {
        recovered = decision.receipt;
        return recovered;
      }
      writeDecision(db, space, entryId, decision);
      return decision.receipt;
    });
  } catch (cause) {
    return recoverCommit(cause, recovered, memoryId, requestId);
  }
}
