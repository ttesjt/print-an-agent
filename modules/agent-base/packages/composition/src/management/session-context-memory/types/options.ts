import type {
  InspectableSessionPort,
  SessionMemoryPort,
  SessionReference,
} from '@print-an-agent/base-session';
import type { ContextMemoryToolScope } from '../tools.js';
import type { ContextMemoryWorkflows } from './workflows.js';

export interface SessionContextMemoryOptions {
  readonly agentId?: SessionReference['agentId'];
  readonly writable?: boolean;
  readonly createTools?: (
    scope: ContextMemoryToolScope
  ) => readonly import('@print-an-agent/base-tool').ToolDefinition[];
  readonly authorityId: string;
  readonly session: Pick<InspectableSessionPort, 'inspect'> & SessionMemoryPort;
  readonly memory: ContextMemoryWorkflows;
  readonly createMemoryId?: () => string;
}
