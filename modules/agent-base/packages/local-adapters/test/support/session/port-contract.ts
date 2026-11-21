import { describe } from 'vitest';
import { defineSessionCompactionContract } from './compaction-contract.js';
import { defineSessionNavigationContract } from './navigation-contract.js';
import { defineSessionQueryContract } from './queries-contract.js';
import { defineSessionTurnContract } from './turns-contract.js';
import type { SessionPortContractHarness } from './types.js';

export function defineSessionPortContract(
  adapterName: string,
  createHarness: () => SessionPortContractHarness
): void {
  describe(`${adapterName} SessionPort contract`, () => {
    defineSessionQueryContract(createHarness);
    defineSessionTurnContract(createHarness);
    defineSessionCompactionContract(createHarness);
    defineSessionNavigationContract(createHarness);
  });
}
