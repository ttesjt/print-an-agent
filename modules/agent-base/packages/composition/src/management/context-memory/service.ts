import {
  AgentSessionError,
  supportsSessionMemoryNavigation,
  type InspectableSessionPort,
  type SessionMemoryPort,
  type SessionReference,
  type SessionMemoryRecord,
  type SessionMemoryNavigationPort,
  type SessionNavigationCoordinatorPort,
  type SessionExecutionPort,
  type SessionBranchReference,
} from '@print-an-agent/base-session';
import type {
  RequestContextMemory,
  RequestMemoryTarget,
  RequestMemoryRun,
} from '@print-an-agent/base-request';
import {
  type createVersionedContextMemoryBundle,
  type MemoryVersionReference,
  type ApplyMemoryInput,
} from '@print-an-agent/context-memory';
import { MemoryJournal, payload, memoryString, version } from './journal.js';
import { createContextMemoryTools, type ContextMemoryToolScope } from './tools.js';
import {
  applyRuntimeMemory,
  recoverMemoryMutation,
  SessionMemoryCommitError,
} from './mutations.js';
import {
  navigateWithMemory,
  publishMemoryNavigation,
  isSettledNavigationRejection,
} from './navigation.js';
import { initializeSessionMemoryBinding } from './initialization.js';

type BundledMemoryWorkflows = ReturnType<typeof createVersionedContextMemoryBundle>['workflows'];
export type ContextMemoryWorkflows = {
  readonly [K in
    | 'inspect'
    | 'create'
    | 'apply'
    | 'getReceipt'
    | 'inspectVersion'
    | 'readVersionContext'
    | 'fork']: Pick<BundledMemoryWorkflows[K], 'run'>;
};
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
export interface SessionMemoryCheckpoint {
  readonly branchId: string;
  readonly input: MemoryVersionReference;
  readonly final: MemoryVersionReference;
  readonly settled: boolean;
}
export type SessionContextMemoryCoordinator = Pick<
  SessionContextMemoryService,
  keyof SessionContextMemoryService
>;
export type RuntimeMemorySessionPort = Pick<InspectableSessionPort, 'inspect'> &
  SessionMemoryNavigationPort &
  SessionExecutionPort;

/** Application coordinator. All resources are borrowed; no model calls or resource ownership. */
export class SessionContextMemoryService implements RequestContextMemory {
  readonly authorityId: string;
  protected readonly options: SessionContextMemoryOptions;
  constructor(options: SessionContextMemoryOptions) {
    this.options = Object.freeze({ ...options });
    this.authorityId = memoryString(options.authorityId);
  }
  private assertReference(reference: SessionReference) {
    if (this.options.agentId !== undefined && reference.agentId !== this.options.agentId)
      throw new AgentSessionError(
        'SESSION_MEMORY_INVALID',
        'Session belongs to another Agent authority.'
      );
  }

  /** Management reads share the runtime binding; they do not construct an Agent. */
  async inspect(reference: SessionBranchReference, signal?: AbortSignal) {
    this.assertReference(reference);
    const journal = new MemoryJournal(this.options.session, reference);
    const row = await journal.read('binding', reference.branchId);
    if (!row?.settled || payload(row).authorityId !== this.authorityId)
      throw new AgentSessionError(
        'SESSION_MEMORY_NOT_CONFIGURED',
        'Branch has no settled Memory binding.'
      );
    return this.options.memory.inspect.run({
      input: { memoryId: memoryString(payload(row).memoryId) },
      ...(signal === undefined ? {} : { signal }),
    });
  }

  /** Explicit idle write. It never changes a previous Turn's historical checkpoint. */
  async apply(
    reference: SessionBranchReference,
    input: Omit<ApplyMemoryInput, 'memoryId'>,
    signal: AbortSignal = new AbortController().signal
  ): Promise<string> {
    this.assertReference(reference);
    const journal = new MemoryJournal(this.options.session, reference);
    const row = await journal.read('binding', reference.branchId);
    if (!row?.settled || payload(row).authorityId !== this.authorityId)
      throw new AgentSessionError(
        'SESSION_MEMORY_NOT_CONFIGURED',
        'Branch has no settled Memory binding.'
      );
    const pending = await this.options.session.listPendingMemoryRecords(reference);
    if (pending.some((record) => record.kind !== 'mutation' || record.id !== input.requestId))
      throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Recover pending Memory work first.');
    return applyRuntimeMemory({
      journal,
      memory: this.options.memory,
      authorityId: this.authorityId,
      branchId: reference.branchId,
      input: { ...input, memoryId: memoryString(payload(row).memoryId) },
      signal,
    });
  }

  /** Trusted operator acknowledgement AFTER the actual resource owner has confirmed cleanup.
   * This records that confirmation, not a claim that this Service performed resource cleanup.
   */
  async acknowledgeCleanup(
    reference: SessionReference,
    kind: SessionMemoryRecord['kind'],
    id: string,
    expectedRevision: number
  ): Promise<void> {
    this.assertReference(reference);
    const journal = new MemoryJournal(this.options.session, reference);
    const row = await journal.read(kind, id);
    if (
      row === undefined ||
      row.revision !== expectedRevision ||
      payload(row).authorityId !== this.authorityId
    )
      throw new AgentSessionError(
        'SESSION_MEMORY_CONFLICT',
        'Cleanup coordination record changed.'
      );
    const data = payload(row);
    if (data.cleanupPending !== true)
      throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Record has no pending cleanup.');
    await journal.put(
      kind,
      id,
      { ...data, cleanupPending: false },
      kind === 'navigation' && data.applied !== undefined,
      row
    );
  }

  /** Explicit baseline for an existing branch. This never invents checkpoints for old Turns. */
  async initialize(
    reference: SessionBranchReference,
    source?: MemoryVersionReference,
    signal: AbortSignal = new AbortController().signal
  ): Promise<void> {
    this.assertReference(reference);
    signal.throwIfAborted();
    const snapshot = await this.options.session.inspect(reference);
    if (!snapshot?.navigation.branches.some((branch) => branch.branchId === reference.branchId))
      throw new AgentSessionError('SESSION_BRANCH_NOT_FOUND', 'Branch was not found.');
    const journal = new MemoryJournal(this.options.session, reference);
    if ((await this.options.session.listPendingMemoryRecords(reference)).length !== 0)
      throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Recover pending Memory work first.');
    const existing = await journal.read('binding', reference.branchId);
    if (existing !== undefined)
      throw new AgentSessionError(
        'SESSION_MEMORY_CONFLICT',
        'Branch already has a Memory binding.'
      );
    signal.throwIfAborted();
    const row = await journal.put(
      'binding',
      reference.branchId,
      {
        authorityId: this.authorityId,
        memoryId: this.options.createMemoryId?.() ?? `runtime:${crypto.randomUUID()}`,
        ...(source === undefined ? {} : { origin: version(source) }),
      },
      false
    );
    await this.completeBinding(journal, row, signal);
  }

  private async completeBinding(
    journal: MemoryJournal,
    binding: SessionMemoryRecord,
    signal: AbortSignal
  ) {
    return initializeSessionMemoryBinding(this.options, journal, binding, signal);
  }

  async readCheckpoint(
    reference: SessionReference,
    turnId: string
  ): Promise<SessionMemoryCheckpoint | undefined> {
    this.assertReference(reference);
    const row = await this.options.session.readMemoryRecord({
      ...reference,
      kind: 'turn',
      id: turnId,
    });
    if (row === undefined) return undefined;
    const value = payload(row);
    return {
      branchId: memoryString(value.branchId),
      input: version(value.input),
      final: version(value.final),
      settled: row.settled,
    };
  }

  protected async binding(
    journal: MemoryJournal,
    target: RequestMemoryTarget,
    signal: AbortSignal
  ): Promise<SessionMemoryRecord> {
    let binding = await journal.read('binding', target.session.branchId);
    if (binding === undefined) {
      if (target.turn.parentTurnId !== undefined)
        throw new AgentSessionError(
          'SESSION_MEMORY_NOT_CONFIGURED',
          'Existing history needs an explicit Memory baseline.'
        );
      binding = await journal.put(
        'binding',
        target.session.branchId,
        {
          authorityId: this.authorityId,
          memoryId: this.options.createMemoryId?.() ?? `runtime:${crypto.randomUUID()}`,
        },
        false
      );
    }
    return this.completeBinding(journal, binding, signal);
  }

  async open(target: RequestMemoryTarget, signal: AbortSignal): Promise<RequestMemoryRun> {
    this.assertReference(target.session);
    const pending = await this.options.session.listPendingMemoryRecords(target.session);
    if (pending.some((row) => row.kind !== 'binding' || row.id !== target.session.branchId))
      throw new AgentSessionError(
        'SESSION_MEMORY_PENDING',
        'Memory coordination requires recovery.'
      );
    const journal = new MemoryJournal(this.options.session, target.session);
    const binding = await this.binding(journal, target, signal);
    const memoryId = memoryString(payload(binding).memoryId);
    const snapshot = await this.options.memory.inspect.run({ input: { memoryId }, signal });
    if (snapshot === undefined || snapshot.memoryId !== memoryId)
      throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory inspection was skipped.');
    const input = { memoryId, revision: snapshot.revision };
    const rendered = await this.options.memory.readVersionContext.run({ input, signal });
    if (
      rendered === undefined ||
      rendered.snapshot.memoryId !== memoryId ||
      rendered.snapshot.revision !== input.revision
    )
      throw new AgentSessionError(
        'SESSION_MEMORY_INVALID',
        'Memory rendering did not match the pinned version.'
      );
    await journal.put(
      'turn',
      target.turn.turnId,
      { branchId: target.session.branchId, input, final: input },
      false
    );
    let writeFailure: SessionMemoryCommitError | undefined;
    return {
      inputVersion: input,
      text: JSON.stringify({ type: 'session-context-memory', version: input, data: rendered.text }),
      tools: (this.options.createTools ?? createContextMemoryTools)({
        writable: this.options.writable === true,
        read: async (toolSignal) => {
          const current = await this.options.memory.inspect.run({
            input: { memoryId },
            signal: toolSignal,
          });
          if (current === undefined || current.memoryId !== memoryId)
            throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory read was skipped.');
          const checkpoint = await journal.read('turn', target.turn.turnId);
          if (checkpoint === undefined)
            throw new AgentSessionError(
              'SESSION_MEMORY_PENDING',
              'Turn Memory checkpoint is missing.'
            );
          const state = payload(checkpoint);
          const previous = version(state.final);
          if (previous.memoryId !== memoryId)
            throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Read Memory authority differs.');
          if (current.revision > previous.revision)
            await journal.put(
              'turn',
              checkpoint.id,
              { ...state, final: { memoryId, revision: current.revision } },
              false,
              checkpoint
            );
          return JSON.stringify({
            version: { memoryId, revision: current.revision },
            items: current.items,
          });
        },
        apply: async (expectedRevision, commands, callId, toolSignal) => {
          if (this.options.writable !== true)
            throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory is read-only.');
          try {
            return await applyRuntimeMemory({
              journal,
              memory: this.options.memory,
              authorityId: this.authorityId,
              turnId: target.turn.turnId,
              branchId: target.session.branchId,
              input: {
                memoryId,
                requestId: JSON.stringify(['tool', target.requestId, callId]),
                expectedRevision,
                commands,
              },
              signal: toolSignal,
            });
          } catch (cause) {
            if (cause instanceof SessionMemoryCommitError) writeFailure = cause;
            throw cause;
          }
        },
      }),
      settle: async () => {
        const outstanding = await this.options.session.listPendingMemoryRecords(target.session);
        if (outstanding.some((record) => record.kind === 'mutation')) {
          if (writeFailure !== undefined) throw writeFailure;
          throw new AgentSessionError(
            'SESSION_MEMORY_PENDING',
            'Memory tool outcome is unresolved.'
          );
        }
        const row = await journal.read('turn', target.turn.turnId);
        if (row === undefined)
          throw new AgentSessionError(
            'SESSION_MEMORY_PENDING',
            'Turn Memory checkpoint is missing.'
          );
        if (!row.settled) await journal.put('turn', row.id, payload(row), true, row);
      },
    };
  }

  async recover(
    reference: SessionReference,
    signal: AbortSignal = new AbortController().signal
  ): Promise<void> {
    this.assertReference(reference);
    const journal = new MemoryJournal(this.options.session, reference);
    // Each batch is bounded by the port. Loop across settled batches, never infer absence of a receipt.
    while (true) {
      let pending = await this.options.session.listPendingMemoryRecords(reference);
      if (pending.length === 0) return;
      signal.throwIfAborted();
      for (const row of pending) {
        if (row.kind === 'binding') await this.completeBinding(journal, row, signal);
        if (row.kind === 'navigation') {
          const session = this.options.session;
          if (!supportsSessionMemoryNavigation(session))
            throw new AgentSessionError(
              'SESSION_MEMORY_NOT_CONFIGURED',
              'Atomic navigation capability is missing.'
            );
          try {
            await publishMemoryNavigation({ ...this.options, session }, journal, row, signal);
          } catch (cause) {
            const settled = await journal.read('navigation', row.id);
            if (settled === undefined || !isSettledNavigationRejection(settled, cause)) throw cause;
            // A durable rejection is a terminal navigation outcome, not unresolved work.
          }
        }
      }
      for (const row of pending)
        if (row.kind === 'mutation')
          await recoverMemoryMutation(journal, row, this.options.memory, this.authorityId, signal);
      pending = await this.options.session.listPendingMemoryRecords(reference);
      if (
        pending.some(
          (row) => row.kind === 'mutation' || row.kind === 'binding' || row.kind === 'navigation'
        )
      )
        continue;
      for (const row of pending)
        if (row.kind === 'turn') await journal.put('turn', row.id, payload(row), true, row);
    }
  }

  /** Management navigation remains independent of Agent runtime construction and credentials. */
  navigationPort(
    session: RuntimeMemorySessionPort
  ): SessionNavigationCoordinatorPort & SessionExecutionPort {
    if (session !== this.options.session)
      throw new AgentSessionError(
        'SESSION_MEMORY_INVALID',
        'Navigation must use the same Session authority.'
      );
    return {
      inspect: (reference) => {
        this.assertReference(reference);
        return session.inspect(reference);
      },
      acquireSessionExecution: (reference) => {
        this.assertReference(reference);
        return session.acquireSessionExecution(reference);
      },
      releaseSessionExecution: (lease) => {
        this.assertReference(lease);
        return session.releaseSessionExecution(lease);
      },
      applyNavigation: (request) => {
        this.assertReference(request);
        return navigateWithMemory({ ...this.options, session }, request);
      },
    };
  }
}

export function createSessionContextMemory(
  options: SessionContextMemoryOptions
): SessionContextMemoryService {
  return new SessionContextMemoryService(options);
}
