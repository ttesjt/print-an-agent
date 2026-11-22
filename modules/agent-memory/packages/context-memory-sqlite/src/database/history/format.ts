export const HISTORY_RECORD_FORMAT = 1;

export const HISTORY_RECORD_KINDS = ['base', 'delta'] as const;

export type HistoryRecordKind = (typeof HISTORY_RECORD_KINDS)[number];

export function isHistoryRecordKind(value: unknown): value is HistoryRecordKind {
  return HISTORY_RECORD_KINDS.some((kind) => kind === value);
}
