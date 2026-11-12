import type {
  AgentDetails,
  AgentSummary,
  CollectionChoice,
  CompletedConversationTurn,
  ConversationPage,
  ConversationInteractionEventConsumer,
  ConversationSessionAdmission,
  MutationOutcome,
  RevisionedValue,
  StartConversationInteractionInput,
  WorkspacePorts,
} from '@print-an-agent/ui-contracts';

export type ResearchReference = Readonly<{ tenant: string; notebook: number }>;
export interface ResearchPreferences {
  readonly datasets: readonly string[];
  readonly strategy: 'guided' | 'open';
}
export interface ComputeBinding {
  readonly pool: Readonly<{ region: string; slots: number }>;
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const timestamp = '2026-10-10T12:00:00Z';
function agent(agentId: string): AgentDetails {
  return {
    agentId,
    displayName: `Research ${agentId}`,
    identityRevision: 'identity:1',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
function summary(details: AgentDetails): AgentSummary {
  return {
    agentId: details.agentId,
    displayName: details.displayName,
    identityRevision: details.identityRevision,
    status: details.status,
    updatedAt: details.updatedAt,
  };
}
export function researchBackend(tenant = 'lab') {
  const collection: CollectionChoice<ResearchReference> = {
    key: tenant,
    label: `Notebook ${tenant}`,
    reference: { tenant, notebook: 42 },
  };
  const agents = new Map(['alpha', 'beta'].map((id) => [id, agent(id)]));
  const preferences = new Map<string, RevisionedValue<ResearchPreferences>>();
  const compute = new Map<string, RevisionedValue<ComputeBinding>>();
  const sessions = new Map<string, ConversationSessionAdmission>();
  const turns = new Map<string, CompletedConversationTurn[]>();
  const runs = new Map<
    string,
    {
      input: StartConversationInteractionInput;
      consume: ConversationInteractionEventConsumer;
      done: ReturnType<typeof deferred<void>>;
      admission: ConversationSessionAdmission;
    }
  >();
  const controls: {
    preferenceSave?: ReturnType<
      typeof deferred<MutationOutcome<RevisionedValue<ResearchPreferences>>>
    >;
    historyRead?: ReturnType<typeof deferred<ConversationPage>>;
    historyFailed: boolean;
    calls: number;
  } = { historyFailed: false, calls: 0 };
  let nextSession = 0;
  const ports: WorkspacePorts = {
    agents: {
      listAgentPage: ({ cursor }) =>
        Promise.resolve({
          status: 'succeeded',
          value:
            cursor === undefined
              ? { records: [summary(agents.get('alpha')!)], nextCursor: 'after-alpha' }
              : { records: [...agents.values()].filter((a) => a.agentId !== 'alpha').map(summary) },
        }),
      inspectAgentDetails: ({ agentId }) =>
        Promise.resolve(
          agents.has(agentId)
            ? { status: 'succeeded', value: agents.get(agentId)! }
            : {
                status: 'failed',
                failure: { code: 'not-found', message: 'Unknown research Agent' },
              }
        ),
    },
    sessions: {
      listSessions: ({ agentId, status }) =>
        Promise.resolve({
          status: 'succeeded',
          value: {
            records:
              status === 'retired'
                ? []
                : [...sessions.values()].map((s) => s.details).filter((s) => s.agentId === agentId),
          },
        }),
      inspectSession: ({ sessionId }) =>
        Promise.resolve(
          sessions.has(sessionId)
            ? { status: 'succeeded', value: sessions.get(sessionId)!.details }
            : { status: 'failed', failure: { code: 'not-found', message: 'Unknown Session' } }
        ),
      inspectSessionNavigation: ({ sessionId }) =>
        Promise.resolve(
          sessions.has(sessionId)
            ? { status: 'succeeded', value: sessions.get(sessionId)!.navigation }
            : { status: 'failed', failure: { code: 'not-found', message: 'Unknown Session' } }
        ),
    },
    conversations: {
      readConversation: async ({ sessionId }) => {
        if (controls.historyRead)
          return { status: 'succeeded', value: await controls.historyRead.promise };
        if (controls.historyFailed)
          return {
            status: 'failed',
            failure: { code: 'unavailable', message: 'Projection unavailable' },
          };
        return { status: 'succeeded', value: { turns: turns.get(sessionId) ?? [] } };
      },
      streamInteraction: async (input, consume) => {
        controls.calls++;
        const sessionId = input.session?.sessionId ?? `${tenant}-session-${++nextSession}`;
        const admission: ConversationSessionAdmission = {
          details: {
            agentId: input.agentId,
            sessionId,
            selectedBranchId: 'main',
            metadataRevision: 'm1',
            navigationRevision: 'n1',
            branchCount: 1,
            turnCount: 0,
            status: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
            title: input.message,
          },
          navigation: {
            agentId: input.agentId,
            sessionId,
            selectedBranchId: 'main',
            revision: 'n1',
            branches: [{ branchId: 'main', createdAt: timestamp }],
          },
        };
        sessions.set(sessionId, admission);
        const done = deferred<void>();
        const aborted = () => {
          done.resolve();
        };
        input.signal?.addEventListener('abort', aborted, { once: true });
        try {
          await consume({ type: 'interaction-started', interactionId: input.interactionId });
          await consume({
            type: 'session-admitted',
            interactionId: input.interactionId,
            admission,
          });
          await consume({
            type: 'reasoning-delta',
            interactionId: input.interactionId,
            modelTurnIndex: 1,
            delta: `Reasoning ${input.message}`,
          });
          runs.set(sessionId, { input, consume, done, admission });
          if (input.signal?.aborted) done.resolve();
          await done.promise;
          if (input.signal?.aborted)
            await consume({ type: 'cancelled', interactionId: input.interactionId });
        } finally {
          runs.delete(sessionId);
          input.signal?.removeEventListener('abort', aborted);
        }
      },
    },
  };
  const finish = async (sessionId: string, receipt = false) => {
    const run = runs.get(sessionId);
    if (!run) throw new Error('No running fixture interaction');
    const turn: CompletedConversationTurn = {
      turnId: `turn-${run.input.interactionId}`,
      branchId: 'main',
      status: 'completed',
      userMessage: { text: run.input.message, timestamp },
      assistantMessage: {
        text: `Answer ${run.input.message}`,
        timestamp,
        reasoningBlocks: [{ modelTurnIndex: 1, text: `Reasoning ${run.input.message}` }],
        toolActivities: [],
      },
    };
    turns.set(sessionId, [...(turns.get(sessionId) ?? []), turn]);
    await run.consume({
      type: 'text-delta',
      interactionId: run.input.interactionId,
      modelTurnIndex: 1,
      delta: turn.assistantMessage.text,
    });
    await run.consume(
      receipt
        ? {
            type: 'committed',
            interactionId: run.input.interactionId,
            receipt: { sessionId, branchId: 'main', turnId: turn.turnId },
            message: 'Saved; projection needs recovery',
          }
        : { type: 'completed', interactionId: run.input.interactionId, sessionId, turn }
    );
    run.done.resolve();
  };
  return {
    collection,
    ports,
    controls,
    finish,
    runs,
    turns,
    readPreferences: (id: string) =>
      preferences.get(id) ?? {
        revision: 'preferences:3',
        value: { datasets: ['archive'], strategy: 'guided' as const },
      },
    savePreferences: async (
      id: string,
      input: RevisionedValue<ResearchPreferences>
    ): Promise<MutationOutcome<RevisionedValue<ResearchPreferences>>> => {
      if (controls.preferenceSave) {
        const result = await controls.preferenceSave.promise;
        if (result.status === 'committed') preferences.set(id, result.value);
        return result;
      }
      const value = { revision: 'preferences:4', value: input.value };
      preferences.set(id, value);
      return {
        status: 'committed',
        value,
        notices: [{ code: 'index-stale', message: 'Saved; search index needs refresh' }],
      };
    },
    readCompute: (id: string) =>
      compute.get(id) ?? { revision: 'pool:9', value: { pool: { region: 'west', slots: 2 } } },
    saveCompute: (): Promise<MutationOutcome<RevisionedValue<ComputeBinding>>> =>
      Promise.resolve({
        status: 'rejected',
        failure: { code: 'unavailable', message: 'Compute allocation unavailable' },
      }),
    create: (): Promise<MutationOutcome<{ agentId: string }>> => {
      agents.set('gamma', agent('gamma'));
      return Promise.resolve({
        status: 'committed',
        value: { agentId: 'gamma' },
        notices: [{ code: 'prepare-failed', message: 'Created; dataset preparation failed' }],
      });
    },
  };
}
export type ResearchBackend = ReturnType<typeof researchBackend>;
