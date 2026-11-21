import { it } from 'vitest';
import { createToolRegistry } from '../../src/index.js';
import { createLookupTool } from '../support/definition.js';
import { expectAgentToolError } from '../support/errors.js';

it('rejects duplicate registry names', () => {
  const tool = createLookupTool();
  expectAgentToolError(() => createToolRegistry([tool, tool]), 'TOOL_REGISTRY_DUPLICATE');
});
