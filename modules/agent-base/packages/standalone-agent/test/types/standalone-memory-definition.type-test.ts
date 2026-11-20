import {
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  type ManagedAgentDefinitionConfig,
  type MaterializedManagedAgent,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { parseSessionId } from '@print-an-agent/base-session';
import {
  createStandaloneMemorySetup,
  type StandaloneAgentConfig,
  type StandaloneRawAgent,
} from '../../src/index.js';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const setup = createStandaloneMemorySetup({ readEnvironmentVariable: () => undefined });
const definition = setup.definition;
const opened = createAgentRuntimeService(definition).open(parseAgentId('memory-agent'));
void opened;
void createSessionManagementService(definition).list({ agentId: parseAgentId('memory-agent') });
void createSessionNavigationService(definition).inspect({
  agentId: parseAgentId('memory-agent'),
  sessionId: parseSessionId('memory-session'),
});
export type ConfigIsPreserved = Expect<
  Equal<ManagedAgentDefinitionConfig<typeof definition>, StandaloneAgentConfig>
>;
export type RawAgentIsPreserved = Expect<
  Equal<MaterializedManagedAgent<typeof definition>, StandaloneRawAgent>
>;
export type OpenedRawAgentIsPreserved = Expect<Equal<Awaited<typeof opened>, StandaloneRawAgent>>;

createStandaloneMemorySetup({
  readEnvironmentVariable: () => undefined,
  // @ts-expect-error Memory provisioning does not require or accept a filesystem root.
  rootDirectory: '/unused',
});

// @ts-expect-error Provisioning is an internal detail, not a public resource container.
void definition.resourceProvisioner;
void definition.namespace.port.resolve(parseAgentId('memory-agent')).then((namespace) => {
  // @ts-expect-error A Memory namespace handle is not a database path.
  void namespace?.handle.databasePath;
});
