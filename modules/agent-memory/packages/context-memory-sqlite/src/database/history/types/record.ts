import type { HistoryRecordKind } from '../format.js';

export interface HistoryRecord {
  readonly memoryId: string;
  readonly revision: number;
  readonly format: number;
  readonly kind: HistoryRecordKind;
  readonly previousRevision: number | null;
  readonly depth: number;
  readonly digest: string;
  readonly payload: string;
}
