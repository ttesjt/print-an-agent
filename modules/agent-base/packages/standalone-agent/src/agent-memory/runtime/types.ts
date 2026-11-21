import type { StandaloneSessionDefinition } from '../../setup/index.js';
import type { StandaloneSessionContextMemory } from '../types/setup.js';

export type RuntimeMemoryIntegration<N> = Pick<
  StandaloneSessionDefinition<N>,
  'runtime' | 'sessionNavigation' | 'sessionManagement'
> & {
  readonly sessionContextMemory?: StandaloneSessionContextMemory;
};
