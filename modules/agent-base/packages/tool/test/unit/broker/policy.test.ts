import { it } from 'vitest';
import { validateToolExecutionPolicy } from '../../../src/index.js';
import { expectAgentToolError } from '../../support/errors.js';

it('validates execution policy at construction', () => {
  expectAgentToolError(
    () =>
      validateToolExecutionPolicy({
        maxToolCalls: 0,
        toolTimeoutMilliseconds: 1,
        maxArgumentCharacters: 1,
        maxResultCharacters: 2,
        maxTotalResultCharacters: 1,
      }),
    'TOOL_EXECUTION_POLICY_INVALID'
  );
});
