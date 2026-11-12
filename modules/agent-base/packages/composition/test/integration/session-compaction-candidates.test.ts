import { afterEach, expect, it, vi } from 'vitest';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { AgentSessionError } from '@print-an-agent/base-session';
import { compactionFixture, compactionMessage } from '../support/compaction-fixture.js';
import { testCompactionCounter } from '../support/compaction-token-counter.js';

afterEach(() => vi.useRealTimers());

it('rewrites a complete draft with measured feedback, retains original facts and commits once', async () => {
  const outputs = ['x'.repeat(45), 'short'];
  const fixture = await compactionFixture({
    policy: { maxContextTokens: 30, target: { maxTokens: 30 } },
    complete: () =>
      Promise.resolve({ message: compactionMessage(outputs.shift() ?? 'unexpected') }),
  });
  const commit = vi.spyOn(fixture.session, 'commitCompaction');
  await expect(
    fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
  ).resolves.toMatchObject({ status: 'compacted', compactedTurnCount: 2 });
  expect(fixture.requests).toHaveLength(2);
  const retryPrompt = fixture.requests[1]?.messages.at(-1)?.text;
  expect(retryPrompt).toContain('18 tokens');
  expect(retryPrompt).toContain('45 measured tokens');
  expect(retryPrompt).toContain('x'.repeat(45));
  expect(fixture.requests[1]?.messages.some((message) => message.text === 'original-fact-1')).toBe(
    true
  );
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]?.[0].context.text).toBe('short');
  expect((await fixture.session.inspect(fixture.reference))?.turns).toHaveLength(4);
});

it('accepts by real counter results, not character length or provider usage', async () => {
  const count = vi.fn(() => Promise.resolve(2));
  const fixture = await compactionFixture({
    policy: { maxContextTokens: 4, target: { maxTokens: 4 } },
    counter: testCompactionCounter(count),
    complete: () => Promise.resolve({ message: compactionMessage('long-but-two-tokens') }),
  });
  await expect(
    fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
  ).resolves.toMatchObject({ status: 'compacted' });
  expect(fixture.requests).toHaveLength(1);
  expect(count).toHaveBeenCalledTimes(2);
});

it.each([
  { label: 'blank', first: '   ', stop: 'stop' as const },
  { label: 'truncated', first: 'partial-draft', stop: 'length' as const },
])(
  'regenerates from original source rather than reusing $label output',
  async ({ first, stop }) => {
    let calls = 0;
    const fixture = await compactionFixture({
      complete: () =>
        Promise.resolve({
          message: compactionMessage(++calls === 1 ? first : 'valid', calls === 1 ? stop : 'stop'),
        }),
    });
    await fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1]?.messages.at(-1)?.text).toContain('Generate from the original');
    expect(fixture.requests[1]?.messages.at(-1)?.text).not.toContain(first);
  }
);

it('retries a bounded generation rejection but never a Provider failure', async () => {
  let calls = 0;
  const fixture = await compactionFixture({
    complete: () =>
      ++calls === 1
        ? Promise.reject(new ModelInvocationError('MODEL_OUTPUT_LIMIT_EXCEEDED', 'bounded output'))
        : Promise.resolve({ message: compactionMessage('valid') }),
  });
  await fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
  expect(fixture.requests).toHaveLength(2);
  const providerFailure = new ModelInvocationError('MODEL_PROVIDER_FAILED', 'failed');
  const failed = await compactionFixture({ complete: () => Promise.reject(providerFailure) });
  await expect(
    failed.agent.invoke('compactSession', { sessionId: failed.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_RUNTIME_FAILED', cause: providerFailure });
  expect(failed.requests).toHaveLength(1);
});

it.each(['unchanged', 'growing'])(
  'exhausts exactly three calls for %s output without publishing',
  async (mode) => {
    let calls = 0;
    const fixture = await compactionFixture({
      policy: { maxContextTokens: 10, target: { maxTokens: 10 } },
      complete: () =>
        Promise.resolve({
          message: compactionMessage('x'.repeat(20 + (mode === 'growing' ? calls++ : 0))),
        }),
    });
    const commit = vi.spyOn(fixture.session, 'commitCompaction');
    await expect(
      fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
    ).rejects.toMatchObject({
      code: 'SESSION_COMPACTION_ATTEMPTS_EXHAUSTED',
      generationAttempts: 3,
      targetTokens: 10,
      reason: 'token-limit',
    });
    expect(fixture.requests).toHaveLength(3);
    expect(commit).not.toHaveBeenCalled();
    expect(await fixture.session.readCompaction(fixture.reference)).toBeUndefined();
  }
);

it('resolves per-call targets without changing the configured authority', async () => {
  const fixture = await compactionFixture();
  await expect(
    fixture.agent.invoke('compactSession', {
      sessionId: fixture.sessionId,
      target: { maxTokens: 4097 },
    })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });
  expect(fixture.requests).toHaveLength(0);
  await fixture.agent.invoke('compactSession', {
    sessionId: fixture.sessionId,
    target: { limitTokens: 100, ratio: 0.5, reserveTokens: 5 },
  });
  expect(fixture.requests[0]?.messages.at(-1)?.text).toContain('45 tokens');
});

it('fails explicitly before model invocation when the tokenizer is absent or fails', async () => {
  const missing = await compactionFixture({ counter: false });
  await expect(
    missing.agent.invoke('compactSession', { sessionId: missing.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED' });
  expect(missing.requests).toHaveLength(0);
  const failed = await compactionFixture({
    counter: testCompactionCounter(() => Promise.reject(new Error('unavailable'))),
  });
  await expect(
    failed.agent.invoke('compactSession', { sessionId: failed.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TOKENIZER_FAILED' });
  expect(failed.requests).toHaveLength(1);
});

it('rechecks token limits at publication even when validation is overridden', async () => {
  const fixture = await compactionFixture({
    policy: { maxContextTokens: 3, target: { maxTokens: 3 } },
    steps: {
      validateCompactionCandidate: (context) => {
        context.state.assessment = { status: 'accepted', actualTokens: 0 };
        return Promise.resolve();
      },
    },
  });
  const commit = vi.spyOn(fixture.session, 'commitCompaction');
  await expect(
    fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_OUTPUT_INVALID' });
  expect(commit).not.toHaveBeenCalled();
});

it('uses one Operation deadline across all Steps and generations, preserving parent ownership', async () => {
  const fixture = await compactionFixture({
    policy: { timeoutMilliseconds: 20 },
    complete: (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new Error('stopped', { cause: request.signal.reason })),
          { once: true }
        );
      }),
  });
  vi.useFakeTimers();
  const parent = new AbortController();
  const run = fixture.agent.invoke(
    'compactSession',
    { sessionId: fixture.sessionId },
    { signal: parent.signal }
  );
  const assertion = expect(run).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(20);
  await assertion;
  expect(fixture.requests).toHaveLength(1);
  expect(parent.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not regenerate or retry writes after a commit conflict', async () => {
  const fixture = await compactionFixture();
  const commit = vi
    .spyOn(fixture.session, 'commitCompaction')
    .mockRejectedValue(new AgentSessionError('SESSION_COMPACTION_CONFLICT', 'conflict'));
  await expect(
    fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CONFLICT' });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(fixture.requests).toHaveLength(1);
});
