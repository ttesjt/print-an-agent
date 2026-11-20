import type {
  InspectableSessionPort,
  SessionMemoryNavigationPort,
} from '@print-an-agent/base-session';
import type { ContextMemoryWorkflows } from '../types/workflows.js';

export interface MemoryNavigationResources {
  readonly authorityId: string;
  readonly session: Pick<InspectableSessionPort, 'inspect'> & SessionMemoryNavigationPort;
  readonly memory: ContextMemoryWorkflows;
}
