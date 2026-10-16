import { describe, expect, it } from 'vitest';
import type {
  AgentDefinitionError,
  BaseAgentRunContext,
  AgentWorkflow,
  WorkflowDefinitions,
} from '../../src/index.js';
import { resolveWorkflowRegistry, SKIP_WORKFLOW } from '../../src/index.js';

type WorkflowName = 'required' | 'optional';
type TestContext = BaseAgentRunContext;

function workflow(name: string): AgentWorkflow<TestContext> {
  return {
    name,
    run: () => Promise.resolve({ result: undefined, applyTo: () => Promise.resolve() }),
  };
}

function definitions(): WorkflowDefinitions<WorkflowName, TestContext> {
  return {
    required: { workflow: workflow('required'), skippable: false },
    optional: { workflow: workflow('optional'), skippable: true },
  };
}

function expectDefinitionError(run: () => unknown, code: AgentDefinitionError['code']): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected AgentDefinitionError with code ${code}.`);
}

describe('resolveWorkflowRegistry', () => {
  it('supports explicit configuration skip for a skippable Workflow', () => {
    const registry = resolveWorkflowRegistry(definitions(), { optional: SKIP_WORKFLOW });

    expect(registry.optional).toEqual({ status: 'skipped' });
  });

  it('rejects configuration skip for a required Workflow', () => {
    expectDefinitionError(
      () => resolveWorkflowRegistry(definitions(), { required: SKIP_WORKFLOW }),
      'WORKFLOW_NOT_SKIPPABLE'
    );
  });

  it('rejects an unregistered override', () => {
    expectDefinitionError(
      () =>
        resolveWorkflowRegistry(definitions(), {
          unknown: workflow('unknown'),
        } as never),
      'WORKFLOW_OVERRIDE_UNKNOWN'
    );
  });

  it('rejects a registry key and Workflow identity mismatch', () => {
    expectDefinitionError(
      () => resolveWorkflowRegistry(definitions(), { optional: workflow('different') }),
      'WORKFLOW_NAME_MISMATCH'
    );
  });

  it('requires either a default Workflow or an explicit replacement', () => {
    expectDefinitionError(
      () =>
        resolveWorkflowRegistry({
          required: { workflow: workflow('required'), skippable: false },
          optional: { skippable: true },
        }),
      'WORKFLOW_IMPLEMENTATION_MISSING'
    );
  });
});
