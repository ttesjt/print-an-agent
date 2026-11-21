import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { createMemorySessionPersistence } from '@print-an-agent/base-local-adapters';
import { describe, expect, it } from 'vitest';
import { AgentBaseStandaloneError, materializeStandaloneAgentRuntime } from '../../../src/index.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../../support/resource-profile.js';

describe('Standalone materializer dependency boundary', () => {
  const identity = defineAgentIdentity({ id: 'materialized' });
  const config = resourceProfileConfig();
  const options = resourceProfileRuntimeOptions(() => undefined);

  it('returns raw Agent over the exact injected persistence Ports', () => {
    const persistence = createMemorySessionPersistence();
    const agent = materializeStandaloneAgentRuntime({
      identity,
      config,
      ports: persistence,
      options,
    });
    expect(agent.resources.session).toBe(persistence.session);
    expect(agent.resources.requestJournal).toBe(persistence.requestJournal);
    expect(agent).not.toHaveProperty('agent');
    expect(typeof agent.invoke).toBe('function');
  });

  it('rejects omitted or incomplete JavaScript Ports instead of invoking low-level defaults', () => {
    const persistence = createMemorySessionPersistence();
    for (const ports of [
      undefined,
      null,
      {},
      { session: persistence.session },
      { requestJournal: persistence.requestJournal },
      { session: null, requestJournal: persistence.requestJournal },
      { session: persistence.session, requestJournal: null },
    ]) {
      const invoke = (): unknown =>
        Reflect.apply(materializeStandaloneAgentRuntime, undefined, [
          { identity, config, options, ports },
        ]);
      expect(invoke).toThrow(AgentBaseStandaloneError);
    }
  });
});
