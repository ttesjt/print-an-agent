import { act } from 'react';
import { afterEach, expect, it } from 'vitest';
import type { WorkspacePorts } from '@print-an-agent/ui-contracts';
import { collectionHash } from '../src/index.js';
import {
  button,
  choose,
  click,
  editMessage,
  flush,
  mountWorkspace,
  navigate,
  removalFixture,
} from './support/removal-fixture.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let mounted: Awaited<ReturnType<typeof mountWorkspace>> | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

it('removes current Agent, cancels its interaction and clears Session, inspector and URL without auto-selection', async () => {
  const fixture = removalFixture();
  mounted = await mountWorkspace(fixture);
  editMessage('owned run');
  click('Send');
  await flush();
  const run = [...fixture.backend.runs.values()][0]!;
  expect(window.location.hash).toContain('session=');
  click('Session details');
  await flush();
  expect(document.querySelector('[data-testid="product-inspector"]')).not.toBeNull();
  const notify = fixture.extensionProps.onRemoved;
  act(() => notify('alpha'));
  await flush();
  expect(run.input.signal?.aborted).toBe(true);
  expect(fixture.extensionProps.agent).toBeUndefined();
  expect(document.querySelector('[data-slot="agent-list-item"][data-selected]')).toBeNull();
  expect(document.querySelector('[data-testid="product-inspector"]')).toBeNull();
  expect(document.querySelector('textarea')).toBeNull();
  expect(document.body.textContent).not.toContain('owned run');
  expect(window.location.hash).not.toMatch(/agent=|session=/u);
  expect(document.body.textContent).not.toContain('Research alpha');
  const calls = fixture.list.mock.calls.length;
  act(() => {
    notify('alpha');
    notify('alpha');
  });
  await flush();
  expect(fixture.list).toHaveBeenCalledTimes(calls);
  act(() => fixture.extensionProps.refresh());
  await flush();
  expect(fixture.extensionProps.agent).toBeUndefined();
  navigate('#agent=alpha&session=old&view=settings');
  await flush();
  expect(window.location.hash).not.toMatch(/agent=|session=/u);
  expect(fixture.extensionProps.agent).toBeUndefined();
});

it('confirmed removal supersedes dirty/working settings and does not leave stale settings visible', async () => {
  window.history.replaceState(null, '', '#agent=alpha&view=settings');
  const fixture = removalFixture();
  mounted = await mountWorkspace(fixture);
  fixture.boundary.dirty = true;
  fixture.boundary.working = true;
  mounted.render();
  expect(document.querySelector('[data-testid="product-settings"]')).not.toBeNull();
  act(() => fixture.extensionProps.onRemoved('alpha'));
  await flush();
  expect(document.querySelector('[data-testid="product-settings"]')).toBeNull();
  expect(document.querySelector('dialog[open]')).toBeNull();
  expect(fixture.extensionProps.agent).toBeUndefined();
});

it('preserves another Agent selection and draft and a third Agent background interaction', async () => {
  const fixture = removalFixture();
  mounted = await mountWorkspace(fixture);
  editMessage('alpha work');
  click('Send');
  await flush();
  const alpha = [...fixture.backend.runs.values()][0]!;
  choose('beta');
  await flush();
  editMessage('beta work');
  click('Send');
  await flush();
  const beta = [...fixture.backend.runs.values()].find((run) => run.input.agentId === 'beta')!;
  choose('gamma');
  await flush();
  editMessage('gamma draft');
  fixture.boundary.dirty = true;
  mounted.render();
  const inspections = fixture.inspect.mock.calls.length;
  const discards = fixture.discard.mock.calls.length;
  act(() => fixture.extensionProps.onRemoved('alpha'));
  await flush();
  expect(alpha.input.signal?.aborted).toBe(true);
  expect(beta.input.signal?.aborted).toBe(false);
  expect(fixture.extensionProps.agent?.agentId).toBe('gamma');
  expect(document.querySelector('textarea')?.value).toBe('gamma draft');
  expect(fixture.inspect).toHaveBeenCalledTimes(inspections);
  expect(fixture.discard).toHaveBeenCalledTimes(discards);
  await act(() =>
    alpha.consume({
      type: 'text-delta',
      interactionId: alpha.input.interactionId,
      modelTurnIndex: 1,
      delta: 'late removed output',
    })
  );
  await act(() => fixture.backend.finish(beta.admission.details.sessionId));
  await flush();
  expect(document.body.textContent).not.toContain('late removed output');
  expect(document.querySelector('textarea')?.value).toBe('gamma draft');
  fixture.boundary.dirty = false;
  mounted.render();
  choose('beta');
  await flush();
  expect(fixture.extensionProps.agent?.agentId).toBe('beta');
  // Repeated old notifications must not clear the newer selection.
  act(() => fixture.extensionProps.onRemoved('alpha'));
  await flush();
  expect(fixture.extensionProps.agent?.agentId).toBe('beta');
});

it('ignores late Agent inspection and catalog responses even from an adapter ignoring cancellation', async () => {
  const fixture = removalFixture();
  mounted = await mountWorkspace(fixture);
  const details = fixture.details.get('alpha')!;
  const inspection =
    Promise.withResolvers<Awaited<ReturnType<WorkspacePorts['agents']['inspectAgentDetails']>>>();
  const catalog =
    Promise.withResolvers<Awaited<ReturnType<WorkspacePorts['agents']['listAgentPage']>>>();
  fixture.inspect.mockImplementationOnce(() => inspection.promise);
  fixture.list.mockImplementationOnce(() => catalog.promise);
  act(() => fixture.extensionProps.refresh());
  await flush();
  const inspectSignal = fixture.inspect.mock.calls.at(-1)?.[0].signal;
  const catalogSignal = fixture.list.mock.calls.at(-1)?.[0].signal;
  act(() => fixture.extensionProps.onRemoved('alpha'));
  await flush();
  expect(inspectSignal?.aborted).toBe(true);
  expect(catalogSignal?.aborted).toBe(true);
  await act(async () => {
    inspection.resolve({ status: 'succeeded', value: details });
    catalog.resolve({ status: 'succeeded', value: { records: [details] } });
    await Promise.resolve();
  });
  expect(fixture.extensionProps.agent).toBeUndefined();
  expect(document.body.textContent).not.toContain('Research alpha');
});

it.each(['alpha', 'beta'])(
  'invalidates a pending navigation when its source or target %s is removed',
  async (removedId) => {
    const fixture = removalFixture();
    mounted = await mountWorkspace(fixture);
    fixture.boundary.dirty = true;
    mounted.render();
    navigate('#agent=beta&view=settings');
    await flush();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    const oldConfirm = button('Discard and continue');
    act(() => fixture.extensionProps.onRemoved(removedId));
    await flush();
    expect(document.querySelector('dialog[open]')).toBeNull();
    act(() => oldConfirm.click());
    await flush();
    expect(fixture.extensionProps.agent?.agentId).toBe(removedId === 'alpha' ? undefined : 'alpha');
    expect(fixture.discard).not.toHaveBeenCalled();
    expect(window.location.hash).not.toContain('beta');
  }
);

it('does not treat read failure or absence in a catalog page as removal', async () => {
  const fixture = removalFixture();
  mounted = await mountWorkspace(fixture);
  fixture.inspect.mockResolvedValueOnce({
    status: 'failed',
    failure: { code: 'unavailable', message: 'Temporarily unavailable' },
  });
  fixture.list.mockResolvedValueOnce({ status: 'succeeded', value: { records: [] } });
  act(() => fixture.extensionProps.refresh());
  await flush();
  expect(fixture.extensionProps.agent?.agentId).toBe('alpha');
  expect(window.location.hash).toContain('agent=alpha');
  expect(document.body.textContent).toContain('Temporarily unavailable');
});

it('ignores a notification retained from an unmounted Collection with the same Agent ID', async () => {
  const a = removalFixture(),
    b = removalFixture();
  window.history.replaceState(null, '', collectionHash('a', { agentId: 'alpha' }));
  mounted = await mountWorkspace(a, 'a');
  const oldNotify = a.extensionProps.onRemoved;
  window.history.replaceState(null, '', collectionHash('b', { agentId: 'alpha' }));
  mounted.render(b, 'b');
  await flush();
  editMessage('belongs to b');
  const calls = b.list.mock.calls.length;
  act(() => oldNotify('alpha'));
  await flush();
  expect(b.extensionProps.agent?.agentId).toBe('alpha');
  expect(b.list).toHaveBeenCalledTimes(calls);
  expect(document.querySelector('textarea')?.value).toBe('belongs to b');
  expect(window.location.hash).toContain('b');
});

it('invalidates pending Session inspection and ignores its late snapshot after removal', async () => {
  const fixture = removalFixture();
  const start = fixture.ports.conversations.streamInteraction(
    { agentId: 'alpha', interactionId: 'seed', message: 'saved' },
    () => Promise.resolve()
  );
  await flush();
  const saved = [...fixture.backend.runs.values()][0]!;
  await fixture.backend.finish(saved.admission.details.sessionId);
  await start;
  const pending =
    Promise.withResolvers<Awaited<ReturnType<WorkspacePorts['sessions']['inspectSession']>>>();
  let signal: AbortSignal | undefined;
  fixture.ports.sessions.inspectSession = (input) => {
    signal = input.signal;
    return pending.promise;
  };
  window.history.replaceState(
    null,
    '',
    `#agent=alpha&session=${saved.admission.details.sessionId}`
  );
  mounted = await mountWorkspace(fixture);
  act(() => fixture.extensionProps.onRemoved('alpha'));
  await flush();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve({ status: 'succeeded', value: saved.admission.details });
    await Promise.resolve();
  });
  expect(fixture.extensionProps.agent).toBeUndefined();
  expect(window.location.hash).not.toMatch(/agent=|session=/u);
  expect(document.body.textContent).not.toContain('Answer saved');
});
