import { afterEach, beforeAll, afterAll, expect, it } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TemporaryConversationFeature } from '../../src/temporary-conversation/feature.js';
import { createDeterministicTemporaryConversation } from '../../src/adapters/deterministic-temporary-conversation.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const roots: Root[] = [];
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});
const agent = {
  agentId: 'demo',
  displayName: 'Demo',
  status: 'active' as const,
  identityRevision: '1',
  createdAt: new Date(1).toISOString(),
  updatedAt: new Date(1).toISOString(),
};
function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (value) => value.textContent?.trim() === text
  );
  if (button === undefined) throw new Error(`Missing button: ${text}`);
  button.click();
}
function enter(value: string) {
  const field = document.querySelector('textarea');
  if (field === null) throw new Error('Expected Composer');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
async function press(label: string) {
  await act(async () => {
    click(label);
    await Promise.resolve();
  });
}
function mount(readRevision = () => '1', port = createDeterministicTemporaryConversation()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      <StrictMode>
        <TemporaryConversationFeature
          port={port}
          agent={agent}
          allowed
          agents={{
            readAgentConfig: () =>
              Promise.resolve({
                status: 'succeeded',
                value: { agentId: 'demo', revision: readRevision(), value: DEFAULT_AGENT_CONFIG },
              }),
          }}
        />
      </StrictMode>
    )
  );
}
it('supports temporary follow-up, reasoning, close/reopen and clear under StrictMode', async () => {
  mount();
  await press('Temporary conversation');
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  act(() => enter('first'));
  await press('Send temporary message');
  expect(document.querySelector('[data-state="completed"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Temporary reply (1): first');
  expect(document.body.textContent).toContain('Thinking');
  const summary = document.querySelector('summary');
  act(() => {
    summary?.click();
  });
  expect(document.querySelector('details')?.open).toBe(true);
  act(() => click('Close temporary conversation'));
  await press('Temporary conversation');
  expect(document.body.textContent).toContain('Temporary reply (1): first');
  expect(document.querySelector('details')?.open).toBe(true);
  act(() => enter('second'));
  await press('Send temporary message');
  expect(document.body.textContent).toContain('Temporary reply (2): second');
  expect(document.body.textContent).not.toContain('Fork');
  expect(document.body.textContent).not.toContain('Rewind');
  await press('Clear conversation');
  expect(document.body.textContent).not.toContain('Temporary reply (1): first');
  expect(document.querySelector('textarea')?.value).toBe('');
});

it('requires explicit reset before using a changed published revision', async () => {
  let revision = '1';
  mount(() => revision);
  await press('Temporary conversation');
  act(() => enter('old revision'));
  await press('Send temporary message');
  act(() => click('Close temporary conversation'));
  revision = '2';
  await press('Temporary conversation');
  expect(document.querySelector('dialog[open]')?.textContent).toContain(
    'Replace temporary conversation?'
  );
  await press('Keep temporary history');
  await press('Temporary conversation');
  await press('Reset and continue');
  expect(document.querySelector('dialog[open]')?.textContent).toContain('Temporary conversation');
  expect(document.body.textContent).not.toContain('old revision');
});

it('Escape closes the panel and a fresh mount has no prior transcript', async () => {
  mount();
  await press('Temporary conversation');
  act(() => enter('temporary secret'));
  await press('Send temporary message');
  const dialog = document.querySelector('dialog[open]');
  act(() => {
    dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(document.querySelector('dialog[open]')).toBeNull();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  mount();
  await press('Temporary conversation');
  expect(document.body.textContent).not.toContain('temporary secret');
});

it('hides a live response without cancellation and restores its progress on reopen', async () => {
  const entered = Promise.withResolvers<AbortSignal | undefined>();
  const release = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const fixture = createDeterministicTemporaryConversation();
  let calls = 0;
  mount(undefined, {
    streamTemporaryConversation: async (input, consume) => {
      calls++;
      try {
        await fixture.streamTemporaryConversation(input, async (event) => {
          await consume(event);
          if (event.type === 'reasoning-delta') {
            entered.resolve(input.signal);
            await release.promise;
          }
        });
      } finally {
        settled.resolve();
      }
    },
  });
  await press('Temporary conversation');
  act(() => enter('continue while hidden'));
  await press('Send temporary message');
  const signal = await entered.promise;
  const dialog = document.querySelector('dialog[open]');
  act(() => {
    dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(document.querySelector('dialog[open]')).toBeNull();
  expect(signal?.aborted).toBe(false);
  await press('Temporary conversation');
  expect(document.body.textContent).toContain('Responding…');
  expect(document.body.textContent).toContain('continue while hidden');
  expect(document.body.textContent).toContain('Cancel response');
  expect(calls).toBe(1);
  await act(async () => {
    release.resolve();
    await settled.promise;
  });
  expect(document.querySelector('[data-state="completed"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Temporary reply (1): continue while hidden');
  expect(signal?.aborted).toBe(false);
});
