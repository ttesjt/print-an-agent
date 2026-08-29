import { randomUUID } from 'node:crypto';

import type {
  WorkbenchClock,
  WorkbenchGeneratedIdKind,
  WorkbenchIdSource,
} from '@ta-agent/workbench-control-plane';

export function createRandomWorkbenchIdSource(): WorkbenchIdSource {
  return Object.freeze({
    nextId: (kind: WorkbenchGeneratedIdKind): string => `${kind}:${randomUUID()}`,
  });
}

export function createSystemWorkbenchClock(): WorkbenchClock {
  return Object.freeze({ now: () => new Date().toISOString() });
}
