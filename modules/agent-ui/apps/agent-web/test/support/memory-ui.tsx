import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { onTestFinished } from 'vitest';
import { MemoryManagement } from '../../src/memory/ui/management.js';
import type { WebMemoryPorts } from '../../src/memory/contracts.js';

export function mountMemory(ports: WebMemoryPorts | undefined, agentId = 'a') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (id: string, memory = ports) =>
    act(() =>
      root.render(
        <MemoryManagement ports={memory} agentId={id}>
          {(surfaces) => (
            <>
              {surfaces.action}
              {surfaces.panel}
              <output data-testid="memory-boundary">
                {surfaces.boundary?.working
                  ? 'working'
                  : surfaces.boundary?.dirty
                    ? 'dirty'
                    : 'clean'}
              </output>
            </>
          )}
        </MemoryManagement>
      )
    );
  render(agentId);
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { render };
}
export function button(label: string) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
  const button = buttons.find((node) => node.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button ${label}: ${document.body.textContent}`);
  return button;
}
export function click(label: string) {
  act(() => button(label).click());
}
export function field(label: string) {
  const node = [...document.querySelectorAll('label')].find(
    (node) => node.textContent?.trim() === label
  );
  const control = node?.htmlFor ? document.getElementById(node.htmlFor) : undefined;
  if (
    !(
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    )
  )
    throw new Error(`Missing field ${label}`);
  return control;
}
export function edit(label: string, value: string) {
  const node = field(label);
  const prototype =
    node instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : node instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
export async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (check()) return;
  }
  throw new Error(`Memory UI did not settle: ${document.body.textContent}`);
}
