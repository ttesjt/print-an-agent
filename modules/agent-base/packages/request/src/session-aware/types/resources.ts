import type { ResponsibilityRouter } from '@print-an-agent/base-actor';
import type { SessionPort } from '@print-an-agent/base-session';
import type { ToolExecutionPolicy, ToolName, ToolRegistry } from '@print-an-agent/base-tool';
import type { RequestJournalPort } from '../replay/index.js';
import type { InstructionContributor } from './instructions.js';
import type { RequestContextMemory } from './memory.js';
import type { OutputSink } from './output.js';

export interface RequestRuntimeResources {
  readonly contextMemory?: RequestContextMemory;
  readonly session: SessionPort;
  readonly requestJournal: RequestJournalPort;
  readonly responsibilities: ResponsibilityRouter;
  readonly instructionContributors: readonly InstructionContributor[];
  readonly toolRegistry: ToolRegistry;
  readonly productToolAllowList: readonly ToolName[];
  readonly runtimeToolAllowList: readonly ToolName[];
  readonly toolExecutionPolicy: ToolExecutionPolicy;
  readonly createOutputSink: () => OutputSink;
  readonly clock: () => number;
}
