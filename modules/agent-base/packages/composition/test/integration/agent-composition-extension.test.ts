import { Workflow, STEP_CARDINALITY } from '@print-an-agent/workflow-core';
import { bindAgentWorkflow } from '@print-an-agent/base-runtime';
import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import type { AgentOperationDefinitionMap } from '@print-an-agent/base-runtime';
import {
  defineAgentOperation,
  type AgentRunContextFactoryInput,
  type BaseAgentRunContext,
} from '@print-an-agent/base-runtime';
import { describe, expect, it } from 'vitest';
import {
  AgentCompositionError,
  composeAgentWithExtensions,
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
  type AgentCompositionExtensionFactory,
  type ComposeAgentOptions,
  type StandardAgentDefinition,
} from '../../src/index.js';

type ProductStepName = 'readProductResource';

interface ProductService {
  readonly label: string;
}

interface ProductRunContext extends BaseAgentRunContext<string, string> {
  readonly service: ProductService;
}

function createOptions(): ComposeAgentOptions {
  return {
    identity: { id: 'extended-agent' },
    actorCatalog: createActorCatalog({
      actors: [{ id: MAIN_ACTOR_ID, engineId: 'unused-test-engine' }],
      engines: [
        {
          id: 'unused-test-engine',
          capabilities: {
            invocationModes: ['interaction'],
            inputMediaTypes: ['text'],
            interaction: { streamable: true },
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          interact: () =>
            Promise.reject(new Error('The product-only test must not call the Engine.')),
        },
      ],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
  };
}

function expectCompositionError(run: () => unknown, code: AgentCompositionError['code']): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentCompositionError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected AgentCompositionError with code ${code}.`);
}

describe('Agent composition extensions', () => {
  it('constructs one Agent with standard and typed product behavior', async () => {
    const service = Object.freeze({ label: 'self-learn' });
    let observedStandardDefinition: StandardAgentDefinition | undefined;
    const agent = composeAgentWithExtensions(createOptions(), (standard) => {
      observedStandardDefinition = standard;
      const workflow = bindAgentWorkflow({
        workflow: new Workflow<
          ProductStepName,
          ProductRunContext,
          Record<never, never>,
          undefined,
          string
        >({
          name: 'inspectProduct',
          resources: undefined,
          entryStep: 'readProductResource',
          stepDefinitions: {
            readProductResource: {
              cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
              skippable: false,
              step: (context) => {
                context.result = `${context.input.service.label}:${context.input.input}`;
                return Promise.resolve();
              },
            },
          },
          createState: () => ({}),
          createResult: () => '',
        }),
        applyResult: (context, result) => {
          context.output = result;
          return Promise.resolve();
        },
      });
      const callableOperations = Object.freeze({
        compactSession: standard.operations.compactSession.reference,
      });
      const inspectProduct = defineAgentOperation({
        name: 'inspectProduct',
        exposure: 'public',
        workflowPlan: [workflow],
        config: Object.freeze({}),
        resources: Object.freeze({ service }),
        callableOperations,
        createContext: (
          base: AgentRunContextFactoryInput<
            string,
            Readonly<Record<string, never>>,
            Readonly<{ service: ProductService }>,
            typeof callableOperations
          >
        ): ProductRunContext => ({ ...base, service: base.resources.service }),
      });
      return Object.freeze({
        resources: Object.freeze({ selfLearn: service }),
        operations: Object.freeze({ inspectProduct }),
      });
    });

    expect(observedStandardDefinition).toBeDefined();
    expect(agent.operations.foreground).toBe(observedStandardDefinition?.operations.foreground);
    expect(agent.resources.selfLearn).toBe(service);
    expect(agent.operationNames).toEqual([
      FOREGROUND_AGENT_OPERATION_NAME,
      SESSION_COMPACTION_AGENT_OPERATION_NAME,
      'inspectProduct',
    ]);
    expect(agent.workflowCatalog.names).toContain('inspectProduct');
    await expect(agent.invoke('inspectProduct', 'ready')).resolves.toBe('self-learn:ready');
  });

  it('rejects attempts to replace a standard resource', () => {
    const invalidFactory = (() => ({
      resources: { session: 'replacement' },
      operations: {},
    })) as unknown as AgentCompositionExtensionFactory<
      Readonly<{ session: string }>,
      AgentOperationDefinitionMap
    >;

    expectCompositionError(
      () => composeAgentWithExtensions(createOptions(), invalidFactory),
      'AGENT_COMPOSITION_RESOURCE_NAME_CONFLICT'
    );
  });

  it('rejects attempts to replace a standard Operation', () => {
    const invalidFactory = ((
      standard: Parameters<AgentCompositionExtensionFactory<object, AgentOperationDefinitionMap>>[0]
    ) => ({
      resources: {},
      operations: { foreground: standard.operations.foreground },
    })) as unknown as AgentCompositionExtensionFactory<object, AgentOperationDefinitionMap>;

    expectCompositionError(
      () => composeAgentWithExtensions(createOptions(), invalidFactory),
      'AGENT_COMPOSITION_OPERATION_NAME_CONFLICT'
    );
  });
});
