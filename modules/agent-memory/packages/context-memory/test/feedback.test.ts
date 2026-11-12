import { expect, it } from 'vitest';
import { refineMemoryCompactionTarget } from '@print-an-agent/context-memory';

const policy = { retrySafetyFactor: 0.9, minPlannerTargetTokens: 1 };
it('tightens the body target from C while measuring acceptance by F', () => {
  expect(
    refineMemoryCompactionTarget({
      currentTargetTokens: 3276,
      policy,
      assessment: {
        accepted: false,
        contentTokens: 3000,
        actualTokens: 4200,
        targetTokens: 3276,
        violations: [{ kind: 'target', actual: 4200, limit: 3276 }],
      },
    })
  ).toBe(2106);
});
it('combines independent budgets as dimensionless violation ratios and respects the configured minimum', () => {
  const assessment = {
    accepted: false,
    contentTokens: 3000,
    actualTokens: 4200,
    violations: [
      { kind: 'target', actual: 4200, limit: 3276 },
      { kind: 'document', actual: 9000, limit: 3000 },
    ],
  };
  expect(refineMemoryCompactionTarget({ currentTargetTokens: 3276, policy, assessment })).toBe(900);
  expect(
    refineMemoryCompactionTarget({
      currentTargetTokens: 3,
      policy: { ...policy, minPlannerTargetTokens: 3 },
      assessment,
    })
  ).toBe(3);
});
it('rejects invalid policy and a non-violation rather than returning a magic fallback', () => {
  expect(() =>
    refineMemoryCompactionTarget({
      currentTargetTokens: 10,
      policy: { ...policy, retrySafetyFactor: 0 },
      assessment: {
        accepted: false,
        actualTokens: 20,
        contentTokens: 20,
        violations: [{ kind: 'target', actual: 20, limit: 10 }],
      },
    })
  ).toThrow();
  expect(() =>
    refineMemoryCompactionTarget({
      currentTargetTokens: 10,
      policy,
      assessment: {
        accepted: false,
        actualTokens: 1,
        contentTokens: 1,
        violations: [{ kind: 'target', actual: 1, limit: 10 }],
      },
    })
  ).toThrow();
});
