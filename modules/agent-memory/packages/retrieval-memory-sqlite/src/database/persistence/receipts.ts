import type { DatabaseSync } from 'node:sqlite';
import { parseRetrievalReceipt, type RetrievalReceipt } from '@print-an-agent/retrieval-memory';
import { decodeJson, encodeJson } from './json.js';

export function readReceipt(
  db: DatabaseSync,
  memoryId: string,
  requestId: string
): RetrievalReceipt | undefined {
  const row = db
    .prepare('SELECT payload FROM rm_receipts WHERE memory_id=? AND request_id=?')
    .get(memoryId, requestId);
  return row === undefined ? undefined : parseRetrievalReceipt(decodeJson(row.payload));
}

export function writeReceipt(db: DatabaseSync, receipt: RetrievalReceipt): void {
  db.prepare('INSERT INTO rm_receipts VALUES(?,?,?)').run(
    receipt.memoryId,
    receipt.requestId,
    encodeJson(receipt)
  );
}
