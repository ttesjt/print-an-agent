import type {
  RequestContextMemory,
  RequestMemoryRun,
  RequestMemoryTarget,
} from '@print-an-agent/base-request';
import {
  AgentSessionError,
  type SessionBranchReference,
  type SessionExecutionPort,
  type SessionMemoryRecord,
  type SessionNavigationCoordinatorPort,
  type SessionReference,
} from '@print-an-agent/base-session';
import type { ApplyMemoryInput, MemoryVersionReference } from '@print-an-agent/context-memory';
import { initializeSessionMemoryBinding } from './binding.js';
import { readSessionMemoryCheckpoint } from './checkpoint.js';
import { MemoryJournal, memoryString, payload, version } from './journal.js';
import { applyRuntimeMemory } from './mutations/index.js';
import { navigateWithMemory } from './navigation/index.js';
import { recoverPendingSessionMemory } from './recover-pending.js';
import { openSessionMemoryTurn } from './turn.js';
import type { SessionMemoryCheckpoint } from './types/checkpoint.js';
import type { SessionContextMemoryOptions } from './types/options.js';
import type { RuntimeMemorySessionPort } from './types/ports.js';

export type SessionContextMemoryCoordinator = Pick<
  SessionContextMemoryService,
  keyof SessionContextMemoryService
>;

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
    return readSessionMemoryCheckpoint(this.options, reference, turnId);
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
    return openSessionMemoryTurn(this.options, this.authorityId, target, signal, journal, binding);
  }

  async recover(
    reference: SessionReference,
    signal: AbortSignal = new AbortController().signal
  ): Promise<void> {
    this.assertReference(reference);
    return recoverPendingSessionMemory(
      this.options,
      this.authorityId,
      reference,
      signal,
      (journal, binding, activeSignal) => this.completeBinding(journal, binding, activeSignal)
    );
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
