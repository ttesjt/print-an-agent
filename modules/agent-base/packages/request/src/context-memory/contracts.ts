import type {
  ActiveSessionTurn,
  ResolvedSessionReference,
  SessionWriteAuthority,
  SessionMemoryVersion,
} from '@print-an-agent/base-session';
import type { ToolDefinition } from '@print-an-agent/base-tool';

export interface RequestMemoryTarget {
  readonly session: ResolvedSessionReference & SessionWriteAuthority;
  readonly turn: ActiveSessionTurn;
  readonly requestId: string;
}
/** Run-local borrowed capability. No Registry, adapter access, resource close or model calls. */
export interface RequestMemoryRun {
  readonly inputVersion: SessionMemoryVersion;
  readonly text: string;
  readonly tools: readonly ToolDefinition[];
  /** Seal only after all admitted tool work has joined; a failure must remain recoverable. */
  settle(): Promise<void>;
}
export interface RequestContextMemory {
  open(target: RequestMemoryTarget, signal: AbortSignal): Promise<RequestMemoryRun>;
}
