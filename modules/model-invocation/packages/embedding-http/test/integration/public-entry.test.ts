import * as Api from '@print-an-agent/model-invocation-embedding-http';
import { expect, it } from 'vitest';

it('retains the deliberate compiled runtime API', () => {
  expect(Object.keys(Api).sort()).toEqual(['createHttpTextEmbedder']);
});
