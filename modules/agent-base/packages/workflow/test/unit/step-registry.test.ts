import { describe, expect, it } from 'vitest';
import type {
  AgentDefinitionError,
  BaseWorkflowContext,
  StepDefinitions,
} from '../../src/index.js';
import { resolveStepRegistry, SKIP_STEP } from '../../src/index.js';

type TestStepName = 'required' | 'optional';
type TestContext = BaseWorkflowContext<TestStepName>;

function definitions(): StepDefinitions<TestStepName, TestContext> {
  return {
    required: { step: () => Promise.resolve(), skippable: false },
    optional: { step: () => Promise.resolve(), skippable: true },
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

describe('resolveStepRegistry', () => {
  it('rejects attempts to skip a required step', () => {
    expectDefinitionError(
      () => resolveStepRegistry(definitions(), { required: SKIP_STEP }),
      'STEP_NOT_SKIPPABLE'
    );
  });

  it('rejects a registered step with no default or override', () => {
    expectDefinitionError(
      () =>
        resolveStepRegistry({
          required: { skippable: false },
          optional: { step: () => Promise.resolve(), skippable: true },
        }),
      'STEP_IMPLEMENTATION_MISSING'
    );
  });

  it('rejects an override that has no registered policy definition', () => {
    expectDefinitionError(
      () =>
        resolveStepRegistry(definitions(), {
          unknown: () => Promise.resolve(),
        } as never),
      'STEP_OVERRIDE_UNKNOWN'
    );
  });

  it('treats explicit undefined as the default implementation', () => {
    const registry = resolveStepRegistry(definitions(), { required: undefined });

    expect(registry.required.status).toBe('active');
  });
});
