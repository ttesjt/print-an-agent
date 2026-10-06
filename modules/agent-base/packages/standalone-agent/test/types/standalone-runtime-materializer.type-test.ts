import type { AgentIdentity } from '@ta-agent/base-identity';
import type { RequestJournalPort } from '@ta-agent/base-request';
import type { CompactableSessionPort } from '@ta-agent/base-session';
import {
  materializeStandaloneAgentRuntime,
  createStandaloneAgent,
  type StandaloneRawAgent,
  type StandaloneAgentConfig,
  type StandaloneRuntimeOptions,
} from '../../src/index.js';

declare const identity: AgentIdentity;
declare const config: StandaloneAgentConfig;
declare const session: CompactableSessionPort;
declare const requestJournal: RequestJournalPort;
declare const options: StandaloneRuntimeOptions;

// @ts-expect-error Standalone materialization cannot silently allocate Memory persistence.
materializeStandaloneAgentRuntime({ identity, config, options });
const raw: StandaloneRawAgent = materializeStandaloneAgentRuntime({
  identity,
  config,
  ports: { session, requestJournal },
  options,
});
void raw.invoke('foreground', { message: 'typed raw Agent' });
void raw.invoke('compactSession', { sessionId: 'session' });
// @ts-expect-error Standalone runtime Ports do not imply navigation capability.
void raw.resources.session.applyNavigation;
// @ts-expect-error A raw Agent is not an AgentAPI facade.
void raw.agent;
const created: Promise<StandaloneRawAgent> = createStandaloneAgent({}, options);
void created;
// @ts-expect-error Bootstrap is asynchronous, not an already opened Agent.
const synchronous: StandaloneRawAgent = createStandaloneAgent({}, options);
void synchronous;

materializeStandaloneAgentRuntime({
  identity,
  config,
  // @ts-expect-error Standalone profiles must provide Session and Request Journal together.
  ports: { session },
  options,
});
