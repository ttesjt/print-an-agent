import { expect, it } from 'vitest';
import {
  createToolRegistry,
  defineToolPermissionPolicy,
  resolveEffectiveTools,
} from '../../src/index.js';
import { createLookupTool } from '../support/definition.js';
import { expectAgentToolError } from '../support/errors.js';

it('uses the most restrictive permission intersection and rejects unknown policy names', () => {
  const tool = createLookupTool();
  const registry = createToolRegistry([tool]);
  const allowed = defineToolPermissionPolicy({
    responsibility: ['lookup'],
    actor: ['lookup'],
    product: ['lookup'],
    runtime: ['lookup'],
  });
  const denied = defineToolPermissionPolicy({
    responsibility: ['lookup'],
    actor: [],
    product: ['lookup'],
    runtime: ['lookup'],
  });

  expect(resolveEffectiveTools(registry, allowed).map(({ name }) => name)).toEqual(['lookup']);
  expect(resolveEffectiveTools(registry, denied)).toEqual([]);
  expectAgentToolError(
    () =>
      resolveEffectiveTools(
        registry,
        defineToolPermissionPolicy({
          responsibility: ['missing'],
          actor: [],
          product: [],
          runtime: [],
        })
      ),
    'TOOL_POLICY_INVALID'
  );
});
