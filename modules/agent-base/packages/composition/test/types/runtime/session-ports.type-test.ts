import type { CompactableSessionPort, InspectableSessionPort } from '@print-an-agent/base-session';
import {
  composeAgent,
  composeAgentWithExtensions,
  createStandardAgentDefinition,
  type ComposeAgentOptions,
} from '../../../src/index.js';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const options: Omit<ComposeAgentOptions, 'session'>;
declare const session: CompactableSessionPort;
declare const nonCompactableSession: InspectableSessionPort;

export type StandardRuntimeRequiresOnlyCompaction = Expect<
  Equal<NonNullable<ComposeAgentOptions['session']>, CompactableSessionPort>
>;

const definition = createStandardAgentDefinition({ ...options, session });
const agent = composeAgent({ ...options, session });
const extendedAgent = composeAgentWithExtensions({ ...options, session }, () => ({
  resources: {},
  operations: {},
}));

void definition.resources.session.readCompaction;
void agent.invoke('foreground', { message: 'typed request' });
void agent.invoke('compactSession', { sessionId: 'session' });
void extendedAgent.invoke('compactSession', { sessionId: 'session' });

// @ts-expect-error Standard runtime resources do not promise navigation capability.
void agent.resources.session.applyNavigation;
// @ts-expect-error Navigation is not a Standard Agent Operation.
void agent.invoke('navigateSession', { sessionId: 'session', operation: 'inspect' });
// @ts-expect-error Standard composition still requires the compaction storage contract.
composeAgent({ ...options, session: nonCompactableSession });
