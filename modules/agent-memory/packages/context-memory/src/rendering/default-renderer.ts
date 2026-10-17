import type { MemoryRenderer } from '../contracts/ports.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';

export const DEFAULT_MEMORY_RENDERER: MemoryRenderer = Object.freeze<MemoryRenderer>({
  id: 'context-memory.renderer.v1',
  render(items, options, signal) {
    assertMemoryNotAborted(signal);
    if (options.format === 'text')
      return Promise.resolve(items.map((item) => item.content).join(options.separator));
    if (options.format === 'json')
      return Promise.resolve(JSON.stringify(items.map(({ id, content }) => ({ id, content }))));
    throw new ContextMemoryError(
      'CONFIG_INVALID',
      'The default renderer does not implement custom formats.'
    );
  },
});
