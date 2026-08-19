export const CapabilityDispatchKind = {
  Completed: 'completed',
  Accepted: 'accepted',
} as const;

export type CapabilityDispatchKind =
  (typeof CapabilityDispatchKind)[keyof typeof CapabilityDispatchKind];

export const ExecutionStatus = {
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Lost: 'lost',
} as const;

export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];
