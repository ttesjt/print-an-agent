import { parseTimestamp, type Timestamp } from '@print-an-agent/workbench-domain';

export interface WorkbenchClock {
  now(): string;
}

export function readWorkbenchClock(clock: WorkbenchClock, path: string): Timestamp {
  return parseTimestamp(clock.now(), path);
}
