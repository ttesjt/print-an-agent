import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Notes } from '../../src/qualification/notes.js';
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

afterEach(() => {
  document.body.replaceChildren();
});
describe('independent public component consumer', () => {
  it('preserves semantic behavior without importing a stylesheet', () => {
    const surface = document.createElement('div');
    document.body.append(surface);
    const root = createRoot(surface);
    try {
      act(() => root.render(<Notes />));
      const input = surface.querySelector('input');
      if (input === null) throw new Error('Missing note input');
      expect(input.getAttribute('aria-describedby')).not.toBeNull();
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          'Reusable'
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const button = surface.querySelector('button');
      if (button === null) throw new Error('Missing save command');
      act(() => button.click());
      expect(surface.textContent).toContain('Reusable');
      expect(surface.querySelector('summary')).not.toBeNull();
      expect(surface.querySelector('[style]')).toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });
});
