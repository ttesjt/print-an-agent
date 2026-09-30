import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mountedRoots = new Set<Root>();
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

export function enableReactActEnvironment(): void {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
}

export function disableReactActEnvironment(): void {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
}

export function cleanupReactRoots(): void {
  for (const root of mountedRoots) act(() => root.unmount());
  mountedRoots.clear();
  document.body.replaceChildren();
}

export function renderInDocument(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  act(() => root.render(node));
  return container;
}
