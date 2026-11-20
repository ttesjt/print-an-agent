import type { AgentConfigCodec, ConfigValue } from '@print-an-agent/base-identity-config/config';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type { Agent } from '@print-an-agent/base-runtime';
import {
  defineManagedAgentComposition,
  ManagedAgentCompositionError,
  type AgentConfigProjectionPort,
  type ManagedAgentAuthorityPorts,
  type ManagedAgentNamespacePort,
} from '../../src/index.js';
import { describe, expect, it, vi } from 'vitest';

interface TestConfig {
  readonly label: string;
}

interface TestNamespaceHandle {
  readonly location: string;
}

type TestAgent = Agent<Readonly<Record<never, never>>, Readonly<Record<never, never>>>;

const agentId = parseAgentId('definition-test');

function createInputs() {
  const decode = vi.fn<(value: unknown) => TestConfig>(() => ({ label: 'decoded' }));
  const encode = vi.fn<(config: TestConfig) => ConfigValue>((config) => ({
    label: config.label,
  }));
  const codec: AgentConfigCodec<TestConfig> = {
    schemaVersion: 1,
    decode,
    encode,
  };
  const stage = vi.fn<ManagedAgentNamespacePort<TestNamespaceHandle>['stage']>(() =>
    Promise.resolve({
      agentId,
      handle: { location: 'staged' },
      phase: 'staged',
      resumed: false,
    })
  );
  const publish = vi.fn<ManagedAgentNamespacePort<TestNamespaceHandle>['publish']>((staged) =>
    Promise.resolve({
      agentId: staged.agentId,
      handle: staged.handle,
      phase: 'published',
    })
  );
  const abort = vi.fn<ManagedAgentNamespacePort<TestNamespaceHandle>['abort']>(() =>
    Promise.resolve()
  );
  const resolve = vi.fn<ManagedAgentNamespacePort<TestNamespaceHandle>['resolve']>(() =>
    Promise.resolve(undefined)
  );
  const list = vi.fn<ManagedAgentNamespacePort<TestNamespaceHandle>['list']>(() =>
    Promise.resolve([])
  );
  const namespacePort: ManagedAgentNamespacePort<TestNamespaceHandle> = {
    stage,
    publish,
    abort,
    resolve,
    list,
  };
  const authorityPorts = {} as ManagedAgentAuthorityPorts;
  const createAuthorityPorts = vi.fn(() => authorityPorts);
  const createRuntimePorts = vi.fn(() => ({ runtimeToken: 'runtime' as const }));
  const rawAgent = {} as TestAgent;
  const materialize = vi.fn(() => rawAgent);
  const publishProjection = vi.fn<
    AgentConfigProjectionPort<TestNamespaceHandle, TestConfig>['publish']
  >(() => Promise.resolve());
  const reconcileProjection = vi.fn<
    AgentConfigProjectionPort<TestNamespaceHandle, TestConfig>['reconcile']
  >(() => Promise.resolve({ kind: 'current' }));
  const projectionPort: AgentConfigProjectionPort<TestNamespaceHandle, TestConfig> = {
    publish: publishProjection,
    reconcile: reconcileProjection,
  };
  const createSessionManagementPorts = vi.fn(() => ({ maintenance: true as const }));
  const createSessionNavigationPorts = vi.fn(() => ({ navigation: true as const }));

  return {
    codec,
    decode,
    encode,
    namespacePort,
    stage,
    publish,
    abort,
    resolve,
    list,
    authorityPorts,
    createAuthorityPorts,
    createRuntimePorts,
    materialize,
    projectionPort,
    publishProjection,
    reconcileProjection,
    createSessionManagementPorts,
    createSessionNavigationPorts,
  };
}

function defineInvalid(input: unknown): unknown {
  return defineManagedAgentComposition(input as never);
}

describe('defineManagedAgentComposition', () => {
  it('validates the closed Memory factory vocabulary without executing factories', () => {
    const inputs = createInputs();
    const factory = vi.fn();
    const resolve = Object.fromEntries(
      ['inspect', 'getReceipt', 'replay', 'create', 'apply', 'configure', 'readContext'].map(
        (key) => [key, factory]
      )
    );
    const core = {
      config: { codec: inputs.codec },
      namespace: { port: inputs.namespacePort },
      authority: { createPorts: inputs.createAuthorityPorts },
      runtime: { createPorts: inputs.createRuntimePorts, materialize: inputs.materialize },
    };
    expect(() => defineInvalid({ ...core, contextMemoryManagement: { resolve } })).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
    expect(() =>
      defineInvalid({
        ...core,
        contextMemoryManagement: { resolve: { ...resolve, surprise: factory } },
      })
    ).toThrow(ManagedAgentCompositionError);
    expect(() =>
      defineInvalid({ ...core, contextMemoryManagement: { resolve: { ...resolve, apply: null } } })
    ).toThrow(ManagedAgentCompositionError);
    expect(() => defineInvalid({ ...core, retrievalMemoryManagement: { resolve } })).toThrow(
      ManagedAgentCompositionError
    );
  });
  it('creates and shallow-freezes grouped wiring without invoking injected behavior', () => {
    const inputs = createInputs();
    const sessionManagement = { createPorts: inputs.createSessionManagementPorts };
    const sessionNavigation = { createPorts: inputs.createSessionNavigationPorts };

    const definition = defineManagedAgentComposition({
      config: { codec: inputs.codec },
      namespace: { port: inputs.namespacePort },
      authority: { createPorts: inputs.createAuthorityPorts },
      runtime: {
        createPorts: inputs.createRuntimePorts,
        materialize: inputs.materialize,
      },
      projection: { port: inputs.projectionPort },
      sessionManagement,
      sessionNavigation,
    });

    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.config)).toBe(true);
    expect(Object.isFrozen(definition.namespace)).toBe(true);
    expect(Object.isFrozen(definition.authority)).toBe(true);
    expect(Object.isFrozen(definition.runtime)).toBe(true);
    expect(Object.isFrozen(definition.projection)).toBe(true);
    expect(Object.isFrozen(definition.sessionManagement)).toBe(true);
    expect(Object.isFrozen(definition.sessionNavigation)).toBe(true);

    expect(definition.config.codec).toBe(inputs.codec);
    expect(definition.namespace.port).toBe(inputs.namespacePort);
    expect(definition.projection?.port).toBe(inputs.projectionPort);
    expect(Object.isFrozen(inputs.codec)).toBe(false);
    expect(Object.isFrozen(inputs.namespacePort)).toBe(false);
    expect(Object.isFrozen(inputs.projectionPort)).toBe(false);
    expect(Object.isFrozen(sessionManagement)).toBe(false);
    expect(Object.isFrozen(sessionNavigation)).toBe(false);
    expect(definition.sessionManagement).not.toBe(sessionManagement);
    expect(definition.sessionNavigation).not.toBe(sessionNavigation);

    expect(inputs.decode).not.toHaveBeenCalled();
    expect(inputs.encode).not.toHaveBeenCalled();
    expect(inputs.stage).not.toHaveBeenCalled();
    expect(inputs.publish).not.toHaveBeenCalled();
    expect(inputs.abort).not.toHaveBeenCalled();
    expect(inputs.resolve).not.toHaveBeenCalled();
    expect(inputs.list).not.toHaveBeenCalled();
    expect(inputs.createAuthorityPorts).not.toHaveBeenCalled();
    expect(inputs.createRuntimePorts).not.toHaveBeenCalled();
    expect(inputs.materialize).not.toHaveBeenCalled();
    expect(inputs.publishProjection).not.toHaveBeenCalled();
    expect(inputs.reconcileProjection).not.toHaveBeenCalled();
    expect(inputs.createSessionManagementPorts).not.toHaveBeenCalled();
    expect(inputs.createSessionNavigationPorts).not.toHaveBeenCalled();
  });

  it('omits optional capability records when they are not configured', () => {
    const inputs = createInputs();

    const definition = defineManagedAgentComposition({
      config: { codec: inputs.codec },
      namespace: { port: inputs.namespacePort },
      authority: { createPorts: inputs.createAuthorityPorts },
      runtime: {
        createPorts: inputs.createRuntimePorts,
        materialize: inputs.materialize,
      },
    });

    expect(Object.hasOwn(definition, 'projection')).toBe(false);
    expect(Object.hasOwn(definition, 'sessionManagement')).toBe(false);
    expect(Object.hasOwn(definition, 'sessionNavigation')).toBe(false);
  });

  it.each([
    {
      label: 'unknown top-level field',
      mutate: (input: Record<string, unknown>) => {
        input['unexpected'] = true;
      },
      fieldPath: 'definition.unexpected',
    },
    {
      label: 'unknown nested field',
      mutate: (input: Record<string, unknown>) => {
        input['runtime'] = {
          ...(input['runtime'] as object),
          unexpected: true,
        };
      },
      fieldPath: 'runtime.unexpected',
    },
    {
      label: 'invalid codec schema version',
      mutate: (input: Record<string, unknown>) => {
        input['config'] = {
          codec: { schemaVersion: 0, decode: vi.fn(), encode: vi.fn() },
        };
      },
      fieldPath: 'config.codec.schemaVersion',
    },
    {
      label: 'incomplete namespace port',
      mutate: (input: Record<string, unknown>) => {
        input['namespace'] = { port: {} };
      },
      fieldPath: 'namespace.port.stage',
    },
    {
      label: 'invalid materializer',
      mutate: (input: Record<string, unknown>) => {
        input['runtime'] = {
          ...(input['runtime'] as object),
          materialize: 'not-a-function',
        };
      },
      fieldPath: 'runtime.materialize',
    },
    {
      label: 'explicit undefined capability',
      mutate: (input: Record<string, unknown>) => {
        input['sessionNavigation'] = undefined;
      },
      fieldPath: 'sessionNavigation',
    },
    {
      label: 'invalid capability factory',
      mutate: (input: Record<string, unknown>) => {
        input['sessionNavigation'] = { createPorts: 'not-a-function' };
      },
      fieldPath: 'sessionNavigation.createPorts',
    },
  ])('rejects $label with a stable composition error', ({ mutate, fieldPath }) => {
    const inputs = createInputs();
    const candidate: Record<string, unknown> = {
      config: { codec: inputs.codec },
      namespace: { port: inputs.namespacePort },
      authority: { createPorts: inputs.createAuthorityPorts },
      runtime: {
        createPorts: inputs.createRuntimePorts,
        materialize: inputs.materialize,
      },
    };
    mutate(candidate);

    let failure: unknown;
    try {
      defineInvalid(candidate);
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(ManagedAgentCompositionError);
    if (!(failure instanceof ManagedAgentCompositionError)) {
      throw new Error('Expected ManagedAgentCompositionError.');
    }
    expect(failure.name).toBe('ManagedAgentCompositionError');
    expect(failure.code).toBe('MANAGED_AGENT_COMPOSITION_INVALID');
    expect(failure.fieldPath).toBe(fieldPath);
  });

  it('rejects accessor-backed framework wiring without evaluating the accessor', () => {
    const inputs = createInputs();
    const getter = vi.fn(() => inputs.materialize);
    const runtime: Record<string, unknown> = { createPorts: inputs.createRuntimePorts };
    Object.defineProperty(runtime, 'materialize', { enumerable: true, get: getter });

    expect(() =>
      defineInvalid({
        config: { codec: inputs.codec },
        namespace: { port: inputs.namespacePort },
        authority: { createPorts: inputs.createAuthorityPorts },
        runtime,
      })
    ).toThrowError(ManagedAgentCompositionError);
    expect(getter).not.toHaveBeenCalled();
  });
});
