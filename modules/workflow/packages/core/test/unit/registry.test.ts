import { describe, expect, it } from 'vitest';
import type { WorkflowDefinitionError, StepDefinitions } from '@ta-agent/workflow-core';
import {
  mergeStepOverrides,
  resolveStepRegistry,
  SKIP_STEP,
  STEP_CARDINALITY,
} from '@ta-agent/workflow-core';

type TestStepName = 'required' | 'optional';
type TestContext = { readonly input: number };

function definitions(): StepDefinitions<TestStepName, TestContext> {
  return {
    required: {
      step: () => Promise.resolve(),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    optional: {
      step: () => Promise.resolve(),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: true,
    },
  };
}

function expectDefinitionError(run: () => unknown, code: WorkflowDefinitionError['code']): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected WorkflowDefinitionError with code ${code}.`);
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
          required: { cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: false },
          optional: {
            step: () => Promise.resolve(),
            cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
            skippable: true,
          },
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

  it('inherits implementation for policy-only overrides and policy for function overrides', () => {
    const original = definitions();
    const custom = () => Promise.resolve();
    const registry = resolveStepRegistry(original, {
      required: { cardinality: STEP_CARDINALITY.REPEATABLE },
      optional: custom,
    });
    expect(registry.required).toEqual({
      status: 'active',
      step: original.required.step,
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    });
    expect(registry.optional).toEqual({
      status: 'active',
      step: custom,
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: true,
    });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.required)).toBe(true);
    expect(Object.isFrozen(STEP_CARDINALITY)).toBe(true);
  });

  it('supports structured skip and implementation replacement with explicit policy', () => {
    const custom = () => Promise.resolve();
    const registry = resolveStepRegistry(definitions(), {
      required: { step: custom, cardinality: STEP_CARDINALITY.REPEATABLE },
      optional: { step: SKIP_STEP, cardinality: STEP_CARDINALITY.REPEATABLE },
    });
    expect(registry.required).toMatchObject({
      step: custom,
      cardinality: STEP_CARDINALITY.REPEATABLE,
    });
    expect(registry.optional).toEqual({
      status: 'skipped',
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: true,
    });
    expect(Object.isFrozen(registry.optional)).toBe(true);
    expectDefinitionError(
      () =>
        resolveStepRegistry(definitions(), {
          required: { step: SKIP_STEP, cardinality: STEP_CARDINALITY.REPEATABLE },
        }),
      'STEP_NOT_SKIPPABLE'
    );
  });

  it('takes a frozen snapshot instead of consulting mutable overrides during execution', () => {
    const override = { cardinality: STEP_CARDINALITY.REPEATABLE, step: () => Promise.resolve() };
    const originalStep = override.step;
    const registry = resolveStepRegistry(definitions(), { optional: override });
    override.step = () => Promise.reject(new Error('replacement'));
    expect(registry.optional).toMatchObject({ step: originalStep });
  });

  it.each([undefined, null, 'once', 'unknown', 1])(
    'rejects invalid required cardinality %s even with a valid override',
    (cardinality) => {
      const original = definitions();
      expectDefinitionError(
        () =>
          resolveStepRegistry(
            {
              ...original,
              required: { ...original.required, cardinality },
            } as never,
            { required: { cardinality: STEP_CARDINALITY.REPEATABLE } }
          ),
        'STEP_CARDINALITY_INVALID'
      );
    }
  );

  it.each([
    null,
    [],
    1,
    'repeatable',
    { step: 1 },
    { skippable: true },
    { cardinality: STEP_CARDINALITY.REPEATABLE, extra: true },
    Object.assign(Object.create({ inherited: true }) as object, {
      cardinality: STEP_CARDINALITY.REPEATABLE,
    }),
  ])('rejects malformed structured override %#', (override) => {
    expectDefinitionError(
      () => resolveStepRegistry(definitions(), { optional: override } as never),
      'STEP_OVERRIDE_INVALID'
    );
  });

  it('validates override cardinality independently', () => {
    expectDefinitionError(
      () => resolveStepRegistry(definitions(), { optional: { cardinality: 'once' } } as never),
      'STEP_CARDINALITY_INVALID'
    );
  });

  it.each([
    { skippable: 'yes', cardinality: STEP_CARDINALITY.AT_MOST_ONCE },
    { step: SKIP_STEP, skippable: true, cardinality: STEP_CARDINALITY.AT_MOST_ONCE },
    { step: 1, skippable: false, cardinality: STEP_CARDINALITY.AT_MOST_ONCE },
    { skippable: true, cardinality: STEP_CARDINALITY.AT_MOST_ONCE, extra: true },
  ])('rejects invalid definitions %#', (definition) => {
    expectDefinitionError(
      () => resolveStepRegistry({ ...definitions(), optional: definition } as never),
      'STEP_DEFINITION_INVALID'
    );
  });

  it('rejects accessors without executing them', () => {
    let reads = 0;
    const override = {
      get cardinality() {
        reads++;
        return STEP_CARDINALITY.REPEATABLE;
      },
    };
    expectDefinitionError(
      () => resolveStepRegistry(definitions(), { optional: override }),
      'STEP_OVERRIDE_INVALID'
    );
    expectDefinitionError(
      () => mergeStepOverrides({ optional: override }),
      'STEP_OVERRIDE_INVALID'
    );
    expect(reads).toBe(0);
  });

  it('merges layers by supplied fields, preserving implementations and policies', () => {
    const implementation = () => Promise.resolve();
    const replacement = () => Promise.resolve();
    const merged = mergeStepOverrides<TestStepName, TestContext>(
      { required: implementation, optional: SKIP_STEP },
      {
        required: { cardinality: STEP_CARDINALITY.REPEATABLE },
        optional: { cardinality: STEP_CARDINALITY.REPEATABLE },
      },
      { required: undefined },
      { required: replacement }
    );
    const registry = resolveStepRegistry(definitions(), merged);
    expect(registry.required).toMatchObject({
      step: replacement,
      cardinality: STEP_CARDINALITY.REPEATABLE,
    });
    expect(registry.optional).toMatchObject({
      status: 'skipped',
      cardinality: STEP_CARDINALITY.REPEATABLE,
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.required)).toBe(true);
  });

  it('does not hide unknown override names while merging', () => {
    const merged = mergeStepOverrides<TestStepName, TestContext>({ unknown: undefined } as never);
    expectDefinitionError(
      () => resolveStepRegistry(definitions(), merged),
      'STEP_OVERRIDE_UNKNOWN'
    );
  });
});
