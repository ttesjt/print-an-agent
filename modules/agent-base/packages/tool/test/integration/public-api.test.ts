import { expect, it } from 'vitest';
import * as api from '../../src/index.js';

it('preserves the deliberate Tool package runtime API', () => {
  expect(Object.keys(api).sort()).toEqual([
    'AgentToolError',
    'DEFAULT_TOOL_EXECUTION_POLICY',
    'DENY_ALL_TOOL_PERMISSION_POLICY',
    'EMPTY_TOOL_REGISTRY',
    'createBoundedToolRuntime',
    'createToolRegistry',
    'defineTool',
    'defineToolPermissionPolicy',
    'parseToolArguments',
    'parseToolName',
    'resolveEffectiveTools',
    'validateToolExecutionPolicy',
  ]);
});
