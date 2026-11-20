import { defineAgentOperation } from '@print-an-agent/base-runtime';
import {
  AgentSessionError,
  defineCompactSessionInput,
  parseSessionBranchId,
  parseSessionId,
  resolveSessionCompactionTarget,
  type SessionCompactionPolicy,
} from '@print-an-agent/base-session';
import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import { composeCompactionWorkflow } from '../compaction-binding.js';
import { SESSION_COMPACTION_AGENT_OPERATION_NAME } from '../names.js';
import type { NoCallableAgentOperations } from '../types/operations.js';
import type { ComposeAgentOptions } from '../types/options.js';
import type { SessionCompactionAgentRunContext } from '../types/run-context.js';

/** One operation boundary owns the deadline for every Step and every generation. */
export async function executeCompactionRun(options: {
  readonly policy: SessionCompactionPolicy;
  readonly signal: AbortSignal;
  readonly execute: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  try {
    await runWithExecutionTimeout(
      {
        parentSignal: options.signal,
        timeoutMilliseconds: options.policy.timeoutMilliseconds,
        createTimeoutFailure: ({ timeoutMilliseconds, cause }) =>
          new AgentSessionError(
            'SESSION_COMPACTION_TIMEOUT',
            `Compaction execution exceeded ${timeoutMilliseconds} milliseconds.`,
            { cause }
          ),
      },
      options.execute
    );
  } catch (cause: unknown) {
    // Cancellation state alone cannot establish ownership of an already settled failure.
    if (options.signal.aborted && Object.is(cause, options.signal.reason)) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_CANCELLED',
        'Compaction was cancelled by its parent.',
        { cause }
      );
    }
    throw cause;
  }
}

export function createCompactionOperation<R extends object>(
  options: ComposeAgentOptions,
  compactionResources: R,
  compactionPolicy: SessionCompactionPolicy,
  session: NonNullable<ComposeAgentOptions['session']>,
  compactionWorkflow: ReturnType<typeof composeCompactionWorkflow>
) {
  return defineAgentOperation<
    typeof SESSION_COMPACTION_AGENT_OPERATION_NAME,
    'public',
    typeof compactionPolicy,
    typeof compactionResources,
    NoCallableAgentOperations,
    SessionCompactionAgentRunContext
  >({
    name: SESSION_COMPACTION_AGENT_OPERATION_NAME,
    exposure: 'public',
    config: compactionPolicy,
    resources: compactionResources,
    workflowPlan: [compactionWorkflow],
    executeRun: ({ config, signal, execute }) =>
      executeCompactionRun({ policy: config, signal, execute }),
    prepareRun: async ({ identity: operationIdentity, input }) => {
      const normalized = defineCompactSessionInput(input);
      const target = resolveSessionCompactionTarget(
        compactionPolicy.maxContextTokens,
        compactionPolicy.target,
        normalized.target
      );
      if (target < compactionPolicy.minimumTargetTokens) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_INVALID',
          'Target is below the minimum planner target.'
        );
      }
      const sessionId = parseSessionId(normalized.sessionId);
      const snapshot = await session.inspect({ agentId: operationIdentity.id, sessionId });
      if (snapshot === undefined) {
        throw new AgentSessionError(
          'SESSION_NOT_FOUND',
          `Session "${sessionId}" does not exist for agent "${operationIdentity.id}".`
        );
      }
      const branchId =
        normalized.branchId === undefined
          ? snapshot.navigation.selectedBranchId
          : parseSessionBranchId(normalized.branchId);
      return Object.freeze({
        input: Object.freeze({
          sessionId,
          branchId,
          ...(normalized.target === undefined ? {} : { target: normalized.target }),
        }),
      });
    },
    createContext: (base): SessionCompactionAgentRunContext => ({
      ...base,
      output: Object.freeze({
        status: 'skipped',
        sessionId: base.input.sessionId,
        branchId: parseSessionBranchId(base.input.branchId),
        reason: 'not-needed',
      }),
    }),
    ...(options.createCompactionRunId === undefined
      ? {}
      : { createRunId: options.createCompactionRunId }),
  });
}
