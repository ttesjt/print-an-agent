import type { AgentIdentity } from '@ta-agent/base-identity';
import type { RequestJournalPort } from '@ta-agent/base-request';
import type { NavigableCompactableSessionPort } from '@ta-agent/base-session';
import {
  materializeStandaloneAgentRuntime,
  type StandaloneAgentConfig,
  type StandaloneRuntimeOptions,
} from '../../src/index.js';

declare const identity: AgentIdentity;
declare const config: StandaloneAgentConfig;
declare const session: NavigableCompactableSessionPort;
declare const requestJournal: RequestJournalPort;
declare const options: StandaloneRuntimeOptions;

materializeStandaloneAgentRuntime({ identity, config, options });
materializeStandaloneAgentRuntime({
  identity,
  config,
  ports: { session, requestJournal },
  options,
});

materializeStandaloneAgentRuntime({
  identity,
  config,
  // @ts-expect-error Standalone profiles must provide Session and Request Journal together.
  ports: { session },
  options,
});
