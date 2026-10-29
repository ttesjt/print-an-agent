import {
  defineManagedAgentComposition,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
} from '@ta-agent/base-composition';
import { AgentBaseStandaloneError } from '../errors.js';
import {
  setupCloseFailure,
  type StandaloneSetup,
  type StandaloneSetupCloseOptions,
} from '../profiles/setup.js';
import type { StandaloneAgentConfig, StandaloneRawAgent } from '../types.js';
import type { StandaloneRuntimePorts } from '../runtime/materialize-standalone-agent.js';

type Definition<N> = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  N,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
> &
  SessionNavigationCapability<N, SessionNavigationPorts>;

/** Only for profiles whose concrete adapters acquire/release connections per operation. */
export function reopenableStandaloneSetup<N>(
  source: Definition<N>
): StandaloneSetup<N> & { readonly definition: Definition<N> } {
  let open = true;
  const closed = Promise.resolve();
  const guard = (): void => {
    if (!open)
      throw new AgentBaseStandaloneError('Standalone Profile setup is closed.', {
        code: 'STANDALONE_AGENT_STORAGE_INVALID',
      });
  };
  const port = source.namespace.port;
  const definition: Definition<N> = defineManagedAgentComposition({
    ...source,
    namespace: {
      port: {
        stage: (id) => {
          guard();
          return port.stage(id);
        },
        publish: (namespace) => {
          guard();
          return port.publish(namespace);
        },
        abort: (namespace) => {
          guard();
          return port.abort(namespace);
        },
        resolve: (id) => {
          guard();
          return port.resolve(id);
        },
        list: () => {
          guard();
          return port.list();
        },
      },
    },
    authority: {
      createPorts: (namespace) => {
        guard();
        return source.authority.createPorts(namespace);
      },
    },
    runtime: {
      createPorts: (input) => {
        guard();
        return source.runtime.createPorts(input);
      },
      materialize: (input) => {
        guard();
        return source.runtime.materialize(input);
      },
    },
    sessionManagement: {
      createPorts: (namespace) => {
        guard();
        return source.sessionManagement.createPorts(namespace);
      },
    },
    sessionNavigation: {
      createPorts: (namespace) => {
        guard();
        return source.sessionNavigation.createPorts(namespace);
      },
    },
  });
  return Object.freeze({
    definition,
    close: (options: StandaloneSetupCloseOptions = {}) => {
      const failure = setupCloseFailure(options);
      if (failure !== undefined) return Promise.reject(failure);
      open = false;
      return closed;
    },
  });
}
