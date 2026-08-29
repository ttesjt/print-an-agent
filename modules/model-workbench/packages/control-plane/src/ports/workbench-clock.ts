import { parseTimestamp, type Timestamp } from '@ta-agent/workbench-domain';

export interface WorkbenchClock {
  now(): string;
}

export function readWorkbenchClock(clock: WorkbenchClock, path: string): Timestamp {
  return parseTimestamp(clock.now(), path);
}
