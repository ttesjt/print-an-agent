import type { ComposeAgentOptions } from '@print-an-agent/base-composition';
import type { RequestPolicy } from '@print-an-agent/base-request';
import type {
  StandaloneCredentialRuntimeOptions,
  StandaloneTokenCounterRuntimeOptions,
} from '../../provider/index.js';

export interface StandaloneRuntimeOptions
  extends StandaloneCredentialRuntimeOptions, StandaloneTokenCounterRuntimeOptions {
  /** Borrowed tokenizer for explicit compaction; never serialized or inferred. */
  readonly sessionCompactionTokenCounter?: ComposeAgentOptions['sessionCompactionTokenCounter'];
  /** Executable host composition, never part of durable Agent JSON configuration. */
  readonly stepOverrides?: ComposeAgentOptions['stepOverrides'];
  /** Non-timeout Request limits; durable Agent configuration owns the timeout. */
  readonly requestLimits?: Omit<RequestPolicy, 'timeoutMilliseconds'>;
}
