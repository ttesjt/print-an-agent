import type { SessionNavigationOutcome } from '@print-an-agent/base-session';

export type SessionNavigationInspectionOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'inspected' }>
>;
export type SessionBranchSelectionOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'selected' }>
>;
export type SessionBranchForkOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'forked' }>
>;
export type SessionBranchRewindOutcome = Extract<
  SessionNavigationOutcome,
  Readonly<{ status: 'rewound' }>
>;
