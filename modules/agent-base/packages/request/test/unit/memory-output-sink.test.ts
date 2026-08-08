import { defineProviderModelReference } from '@ta-agent/base-model';
import { DEFAULT_SESSION_BRANCH_ID, parseSessionId } from '@ta-agent/base-session';
import {
  createBoundedToolRuntime,
  DEFAULT_TOOL_EXECUTION_POLICY,
  DENY_ALL_TOOL_PERMISSION_POLICY,
  EMPTY_TOOL_REGISTRY,
} from '@ta-agent/base-tool';
import { describe, expect, it } from 'vitest';
import { AgentRequestError, MemoryOutputSink } from '../../src/index.js';

const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });
const emptyToolRuntime = createBoundedToolRuntime({
  registry: EMPTY_TOOL_REGISTRY,
  permissionPolicy: DENY_ALL_TOOL_PERMISSION_POLICY,
  executionPolicy: DEFAULT_TOOL_EXECUTION_POLICY,
  signal: new AbortController().signal,
});
emptyToolRuntime.close();
const response = Object.freeze({
  requestId: 'request-1',
  sessionId: parseSessionId('session-1'),
  branchId: DEFAULT_SESSION_BRANCH_ID,
  message: Object.freeze({
    role: 'assistant' as const,
    text: 'hello',
    provider: model.provider,
    model: model.model,
    stopReason: 'stop' as const,
    usage: Object.freeze({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    }),
    timestamp: 2,
  }),
  toolRun: emptyToolRuntime.inspect(),
});

describe('MemoryOutputSink', () => {
  it('enforces open, ordered writes, and one close', async () => {
    const sink = new MemoryOutputSink();
    await sink.open({
      requestId: 'request-1',
      sessionId: response.sessionId,
      branchId: response.branchId,
    });
    await sink.write({ type: 'text-delta', delta: 'hel' });
    await sink.write({ type: 'text-delta', delta: 'lo' });
    await sink.close(response);

    expect(sink.inspect()).toMatchObject({
      status: 'closed',
      events: [
        { type: 'text-delta', delta: 'hel' },
        { type: 'text-delta', delta: 'lo' },
      ],
      response,
    });
    await expect(sink.write({ type: 'text-delta', delta: 'late' })).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_OUTPUT_STATE_INVALID',
      })
    );
  });

  it('can fail before opening and keeps the first terminal failure', async () => {
    const sink = new MemoryOutputSink();
    await sink.fail({ code: 'FIRST', message: 'first' });
    await sink.fail({ code: 'SECOND', message: 'second' });

    expect(sink.inspect()).toEqual({
      status: 'failed',
      events: [],
      failure: { code: 'FIRST', message: 'first' },
    });
  });
});
