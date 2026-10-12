import { act } from 'react';
import { afterEach, expect, it } from 'vitest';
import {
  button,
  click,
  editMessage,
  flush,
  mountWorkspace,
  removalFixture,
} from './support/removal-fixture.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let mounted: Awaited<ReturnType<typeof mountWorkspace>> | undefined;
afterEach(() => {
  mounted?.unmount();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

it.each(['failed', 'cancelled'] as const)(
  'removes an admitted Session whose %s stream still owns unfinished cleanup',
  async (status) => {
    const fixture = removalFixture();
    const stream = fixture.ports.conversations.streamInteraction.bind(fixture.ports.conversations);
    const tail = Promise.withResolvers<void>();
    fixture.ports.conversations.streamInteraction = async (input, consume) => {
      await stream(input, consume);
      await tail.promise;
    };
    mounted = await mountWorkspace(fixture);
    editMessage('Old identity message');
    click('Send');
    await flush();
    const run = [...fixture.backend.runs.values()][0]!;
    await act(() =>
      run.consume(
        status === 'failed'
          ? {
              type: status,
              interactionId: run.input.interactionId,
              failure: { code: 'interaction-failed', message: 'Early model failure' },
            }
          : { type: status, interactionId: run.input.interactionId }
      )
    );
    expect(window.location.hash).toContain('session=');
    expect(button('Send').disabled).toBe(true);
    act(() => fixture.extensionProps.onRemoved('alpha'));
    await flush();
    expect(run.input.signal?.aborted).toBe(true);
    expect(fixture.extensionProps.agent).toBeUndefined();
    expect(window.location.hash).not.toMatch(/agent=|session=/u);
    await act(async () => {
      tail.reject(new Error('Late transport failure'));
      await Promise.resolve();
    });
    await flush();
    const inspections = fixture.inspect.mock.calls.length;
    act(() => fixture.extensionProps.onCreated('alpha'));
    await flush();
    expect(fixture.inspect.mock.calls.length).toBeGreaterThan(inspections);
    click('Conversation');
    await flush();
    expect(document.body.textContent).not.toContain('Early model failure');
    expect(document.body.textContent).not.toContain('Late transport failure');
    expect(document.querySelector('[data-slot="conversation-turn"]')).toBeNull();
    expect(document.querySelector('textarea')?.value).toBe('');
  }
);
