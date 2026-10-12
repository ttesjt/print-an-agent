import { describe, expect, it } from 'vitest';
import type { MutationOutcome, WorkspacePorts } from '../src/index.js';

describe('workspace boundary', () => {
  it('accepts a configuration-free consumer without mutation capabilities', async () => {
    const missing = {
      status: 'failed',
      failure: { code: 'not-found', message: 'Unavailable' },
    } as const;
    const ports: WorkspacePorts = {
      agents: {
        listAgentPage: () =>
          Promise.resolve({ status: 'succeeded', value: { records: [], nextCursor: 'opaque' } }),
        inspectAgentDetails: () => Promise.resolve(missing),
      },
      sessions: {
        listSessions: () => Promise.resolve({ status: 'succeeded', value: { records: [] } }),
        inspectSession: () => Promise.resolve(missing),
        inspectSessionNavigation: () => Promise.resolve(missing),
      },
      conversations: {
        readConversation: () => Promise.resolve({ status: 'succeeded', value: { turns: [] } }),
        streamInteraction: (input, consume) =>
          consume({
            type: 'failed',
            interactionId: input.interactionId,
            failure: { code: 'unavailable', message: 'Unavailable' },
          }),
      },
    };
    expect(await ports.agents.listAgentPage({})).toMatchObject({ value: { nextCursor: 'opaque' } });
    expect(ports.conversations.forkSessionBranch).toBeUndefined();
    expect(ports.sessions.purgeSession).toBeUndefined();
  });

  it('does not turn follow-up failure into a rejected commit', () => {
    const result: MutationOutcome<{ agentId: string }> = {
      status: 'committed',
      value: { agentId: 'created' },
      notices: [{ code: 'preparation-failed', message: 'Saved; retry preparation.' }],
    };
    expect(result.status).toBe('committed');
    expect(result.value.agentId).toBe('created');
  });
});
