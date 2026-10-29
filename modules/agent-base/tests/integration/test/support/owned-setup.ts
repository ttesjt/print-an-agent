import { onTestFinished } from 'vitest';
import {
  createStandaloneAgent,
  createStandaloneMemorySetup,
  createSharedSqliteStandaloneSetup,
  defineStandaloneAgentBootstrapConfig,
  type CreateStandaloneMemoryProfileOptions,
  type CreateSharedSqliteStandaloneProfileOptions,
} from '@ta-agent/base-standalone-agent';

/** Existing bootstrap fixtures remain useful data; ownership is explicitly held by the test. */
export async function bootstrapTestAgent(
  input: unknown,
  options: CreateStandaloneMemoryProfileOptions &
    Pick<CreateSharedSqliteStandaloneProfileOptions, 'sqlite'>
) {
  const bootstrap = defineStandaloneAgentBootstrapConfig(input);
  const creation = {
    identity: bootstrap.identity,
    config: {
      provider: bootstrap.provider,
      ...(bootstrap.credential === undefined ? {} : { credential: bootstrap.credential }),
      mainActor: bootstrap.mainActor,
      request: bootstrap.request,
      sessionCompaction: bootstrap.sessionCompaction,
    },
  };
  if (bootstrap.persistence.kind === 'memory') {
    const setup = createStandaloneMemorySetup(options);
    onTestFinished(() => setup.close());
    return createStandaloneAgent(setup, creation);
  }
  const setup = createSharedSqliteStandaloneSetup({
    ...options,
    databasePath: bootstrap.persistence.databasePath,
  });
  onTestFinished(() => setup.close());
  return createStandaloneAgent(setup, creation);
}

/** The test, not a returned Definition, owns the setup and performs teardown. */
export function testMemoryDefinition(options: CreateStandaloneMemoryProfileOptions) {
  const setup = createStandaloneMemorySetup(options);
  onTestFinished(() => setup.close());
  return setup.definition;
}
