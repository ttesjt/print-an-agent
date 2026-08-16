import { randomUUID } from 'node:crypto';

import type {
  WorkbenchGeneratedIdKind,
  WorkbenchIdSource,
} from '@ta-agent/workbench-control-plane';

export function createRandomWorkbenchIdSource(): WorkbenchIdSource {
  return Object.freeze({
    nextId: (kind: WorkbenchGeneratedIdKind): string => `${kind}:${randomUUID()}`,
  });
}
