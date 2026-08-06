import { defineAgentIdentity } from '@ta-agent/base-identity';
import { defineProviderModelReference } from '@ta-agent/base-model';
import { describe, expect, it } from 'vitest';
import { AgentSessionError, MemorySessionAdapter, parseTurnId } from '../../src/index.js';

const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });
const usage = Object.freeze({
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
});

function user(text: string, timestamp: number) {
  return Object.freeze({ role: 'user' as const, text, timestamp });
}

function assistant(text: string, timestamp: number) {
  return Object.freeze({
    role: 'assistant' as const,
    text,
    provider: model.provider,
    model: model.model,
    stopReason: 'stop' as const,
    usage,
    timestamp,
  });
}

describe('MemorySessionAdapter', () => {
  it('loads only completed turns before the active request', async () => {
    const identity = defineAgentIdentity({ id: 'agent-a' });
    const adapter = new MemorySessionAdapter(() => 'generated-session');
    const session = await adapter.resolve({ agentId: identity.id, requestedSessionId: 'chat' });
    const firstTurnId = parseTurnId('turn-1');
    await adapter.beginTurn({ ...session, turnId: firstTurnId, userMessage: user('one', 1) });
    expect(await adapter.loadHistory({ ...session, beforeTurnId: firstTurnId })).toEqual([]);
    await adapter.completeTurn({
      ...session,
      turnId: firstTurnId,
      assistantMessage: assistant('first', 2),
    });

    const secondTurnId = parseTurnId('turn-2');
    await adapter.beginTurn({ ...session, turnId: secondTurnId, userMessage: user('two', 3) });
    const history = await adapter.loadHistory({ ...session, beforeTurnId: secondTurnId });

    expect(history).toEqual([user('one', 1), assistant('first', 2)]);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[1])).toBe(true);
  });

  it('isolates the same session ID by Agent identity', async () => {
    const adapter = new MemorySessionAdapter();
    const first = await adapter.resolve({
      agentId: defineAgentIdentity({ id: 'first' }).id,
      requestedSessionId: 'shared',
    });
    const second = await adapter.resolve({
      agentId: defineAgentIdentity({ id: 'second' }).id,
      requestedSessionId: 'shared',
    });
    await adapter.beginTurn({
      ...first,
      turnId: parseTurnId('turn-first'),
      userMessage: user('private', 1),
    });

    expect((await adapter.inspect(first))?.turns).toHaveLength(1);
    expect((await adapter.inspect(second))?.turns).toHaveLength(0);
  });

  it('records failure once and rejects an invalid completion transition', async () => {
    const adapter = new MemorySessionAdapter();
    const session = await adapter.resolve({
      agentId: defineAgentIdentity({ id: 'agent' }).id,
      requestedSessionId: 'chat',
    });
    const turnId = parseTurnId('turn');
    await adapter.beginTurn({ ...session, turnId, userMessage: user('hello', 1) });

    const failed = await adapter.failTurn({ ...session, turnId, failureCode: 'PROVIDER_FAILED' });
    expect(failed).toMatchObject({ status: 'failed', failureCode: 'PROVIDER_FAILED' });
    expect(await adapter.failTurn({ ...session, turnId, failureCode: 'OTHER' })).toEqual(failed);
    await expect(
      adapter.completeTurn({ ...session, turnId, assistantMessage: assistant('late', 2) })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_STATE_INVALID' })
    );
  });

  it('rejects duplicate turn authority', async () => {
    const adapter = new MemorySessionAdapter();
    const session = await adapter.resolve({
      agentId: defineAgentIdentity({ id: 'agent' }).id,
      requestedSessionId: 'chat',
    });
    const turnId = parseTurnId('turn');
    await adapter.beginTurn({ ...session, turnId, userMessage: user('hello', 1) });

    await expect(
      adapter.beginTurn({ ...session, turnId, userMessage: user('duplicate', 2) })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_ALREADY_EXISTS' })
    );
  });
});
