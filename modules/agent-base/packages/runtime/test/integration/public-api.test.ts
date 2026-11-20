import { expect, it } from 'vitest';
import * as runtime from '../../src/index.js';

it('preserves the public runtime entry without promoting type-only reference constructors', () => {
  expect(Object.keys(runtime).sort()).toEqual([
    'Agent',
    'AgentDefinitionError',
    'AgentRunError',
    'SKIP_WORKFLOW',
    'bindAgentWorkflow',
    'createAgent',
    'createAgentWorkflowCatalog',
    'createWorkflowTraceObserver',
    'defineAgentOperation',
    'defineAgentOperationReference',
    'resolveWorkflowRegistry',
  ]);
});
