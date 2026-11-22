import type { DatabaseSync } from 'node:sqlite';
import { parseMemoryReceipt } from '@print-an-agent/context-memory';
import type { MemoryReceipt } from '@print-an-agent/context-memory';
import { storedRecord } from './decode-record.js';

export function readReceipt(
  database: DatabaseSync,
  memoryId: string,
  requestId: string
): MemoryReceipt | undefined {
  return storedRecord(memoryId, () => {
    const row = database
      .prepare(
        'SELECT receipt_json FROM context_memory_receipts WHERE memory_id = ? AND request_id = ?'
      )
      .get(memoryId, requestId);
    if (row === undefined) return undefined;
    if (typeof row.receipt_json !== 'string') throw new Error('Invalid stored receipt encoding.');
    const value: unknown = JSON.parse(row.receipt_json);
    const receipt = parseMemoryReceipt(value);
    if (receipt.memoryId !== memoryId || receipt.requestId !== requestId)
      throw new Error('Stored receipt scope mismatch.');
    return receipt;
  });
}

export function writeReceipt(database: DatabaseSync, receipt: MemoryReceipt): void {
  database
    .prepare(
      'INSERT INTO context_memory_receipts (memory_id, request_id, receipt_json) VALUES (?, ?, ?)'
    )
    .run(receipt.memoryId, receipt.requestId, JSON.stringify(receipt));
}
