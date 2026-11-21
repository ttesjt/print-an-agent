import { expect, it } from 'vitest';
import * as pi from '@print-an-agent/model-invocation-pi';
it('retains the compiled runtime API', () => {
  expect(Object.keys(pi).sort()).toEqual([
    'createPiFauxRuntime',
    'createPiProviderRuntime',
    'definePiProviderConfig',
  ]);
});
