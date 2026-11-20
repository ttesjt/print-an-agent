import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { AgentSessionError, parseSessionBranchId, parseTurnId } from '@print-an-agent/base-session';
import type {
  SessionManagementResult,
  SessionDetails,
  SessionNavigationSnapshot,
  SessionBranchMutationResult,
} from '@print-an-agent/ui-contracts';
import type { SessionManagementPort } from '../../application/ports.js';
import { reference } from './history.js';
import { sessionFailure } from './failures.js';
import { projectNavigation, projectSession, revision } from './projection.js';
import type { WebBackendServices } from './profile.js';

export function createWebSessionManagement(services: WebBackendServices): SessionManagementPort {
  const execute = async <Value>(
    signal: AbortSignal | undefined,
    action: () => Promise<Value>,
    readRevision?: () => Promise<string>
  ): Promise<SessionManagementResult<Value>> => {
    signal?.throwIfAborted();
    try {
      const value = await action();
      signal?.throwIfAborted();
      return { status: 'succeeded', value };
    } catch (error) {
      signal?.throwIfAborted();
      return { status: 'failed', failure: await sessionFailure(error, readRevision) };
    }
  };
  const inspect = async (input: {
    agentId: string;
    sessionId: string;
  }): Promise<SessionDetails> => {
    const value = await services.sessions.inspect(reference(input));
    if (value === undefined)
      throw new AgentSessionError('SESSION_NOT_FOUND', 'Session does not exist.');
    return projectSession(value);
  };
  const navigation = async (input: {
    agentId: string;
    sessionId: string;
  }): Promise<SessionNavigationSnapshot> =>
    projectNavigation((await services.navigation.inspect(reference(input))).navigation);
  return {
    inspectSession: (input) => execute(input.signal, () => inspect(input)),
    inspectSessionNavigation: (input) => execute(input.signal, () => navigation(input)),
    listSessions: (input) =>
      execute(input.signal, async () => {
        // Cursors remain opaque to React; the transport checks this closed record at ingestion.
        const cursor = input.cursor === undefined ? undefined : decodeCatalogCursor(input.cursor);
        const common = {
          agentId: parseAgentId(input.agentId),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        };
        const page =
          input.status === 'active'
            ? await services.sessions.list({
                ...common,
                ...(cursor === undefined
                  ? {}
                  : { cursor: { updatedAt: cursor.time, sessionId: cursor.sessionId } }),
              })
            : await services.sessions.listRetired({
                ...common,
                ...(cursor === undefined
                  ? {}
                  : { cursor: { retiredAt: cursor.time, sessionId: cursor.sessionId } }),
              });
        const next = page.nextCursor;
        return {
          records: page.records.map(projectSession),
          ...(next === undefined
            ? {}
            : {
                nextCursor: Buffer.from(
                  JSON.stringify({
                    time: 'updatedAt' in next ? next.updatedAt : next.retiredAt,
                    sessionId: next.sessionId,
                  })
                ).toString('base64url'),
              }),
        };
      }),
    renameSession: (input) =>
      execute(
        input.signal,
        async () => {
          await (
            await services.sessionFor(parseAgentId(input.agentId))
          ).renameSession({
            ...reference(input),
            title: input.title,
            expectedRevision: revision(input.expectedRevision),
          });
          return inspect(input);
        },
        async () => (await inspect(input)).metadataRevision
      ),
    retireSession: (input) =>
      execute(
        input.signal,
        async () => {
          await services.sessions.retire({
            ...reference(input),
            expectedRevision: revision(input.expectedRevision),
          });
          return inspect(input);
        },
        async () => (await inspect(input)).metadataRevision
      ),
    restoreSession: (input) =>
      execute(
        input.signal,
        async () => {
          await services.sessions.restore({
            ...reference(input),
            expectedRevision: revision(input.expectedRevision),
          });
          return inspect(input);
        },
        async () => (await inspect(input)).metadataRevision
      ),
    purgeSession: (input) =>
      execute(
        input.signal,
        () =>
          services.sessions.purge({
            ...reference(input),
            expectedRevision: revision(input.expectedRevision),
            confirmation: input.confirmation,
          }),
        async () => (await inspect(input)).metadataRevision
      ),
    selectSessionBranch: (input) =>
      execute(
        input.signal,
        async () => {
          await services.navigation.select(
            {
              ...reference(input),
              branchId: parseSessionBranchId(input.branchId),
              expectedRevision: revision(input.expectedRevision),
            },
            input.signal === undefined ? {} : { signal: input.signal }
          );
          return navigation(input);
        },
        async () => (await navigation(input)).revision
      ),
  };
}

function decodeCatalogCursor(input: string): { time: number; sessionId: string } {
  if (input.length > 1024) throw new Error('Invalid cursor.');
  const value: unknown = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('time' in value) ||
    !('sessionId' in value) ||
    typeof value.time !== 'number' ||
    !Number.isSafeInteger(value.time) ||
    value.time < 0 ||
    typeof value.sessionId !== 'string' ||
    Object.keys(value).length !== 2
  )
    throw new Error('Invalid cursor.');
  return { time: value.time, sessionId: value.sessionId };
}

export async function mutateBranch(
  services: WebBackendServices,
  input: {
    readonly agentId: string;
    readonly sessionId: string;
    readonly throughTurnId: string;
    readonly expectedRevision: string;
    readonly newBranchId?: string;
    readonly sourceBranchId?: string;
    readonly signal?: AbortSignal;
  },
  operation: 'fork' | 'rewind'
): Promise<SessionManagementResult<SessionBranchMutationResult>> {
  const options = input.signal === undefined ? {} : { signal: input.signal };
  try {
    input.signal?.throwIfAborted();
    const command = {
      ...reference(input),
      throughTurnId: parseTurnId(input.throughTurnId),
      expectedRevision: revision(input.expectedRevision),
      ...(input.newBranchId === undefined
        ? {}
        : { newBranchId: parseSessionBranchId(input.newBranchId) }),
    };
    const outcome =
      operation === 'fork'
        ? await services.navigation.fork(
            { ...command, sourceBranchId: parseSessionBranchId(input.sourceBranchId) },
            options
          )
        : await services.navigation.rewind(command, options);
    const navigation = projectNavigation(
      (await services.navigation.inspect(reference(input), options)).navigation
    );
    input.signal?.throwIfAborted();
    return {
      status: 'succeeded',
      value: { affectedBranchId: outcome.affectedBranchId, navigation },
    };
  } catch (error) {
    input.signal?.throwIfAborted();
    return {
      status: 'failed',
      failure: await sessionFailure(error, async () =>
        String((await services.navigation.inspect(reference(input))).navigation.revision)
      ),
    };
  }
}
