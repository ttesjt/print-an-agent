import { describe, expect, it } from 'vitest';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import type {
  AgentDefinition,
  AgentDefinitionError,
  BaseAgentContext,
  BaseWorkflowContext,
  WorkflowDefinition,
  WorkflowOverrides,
} from '../../src/index.js';
import { Agent, RUN_WORKFLOW, SKIP_WORKFLOW, skipWorkflow, Workflow } from '../../src/index.js';

type WorkflowName = 'first' | 'conditional' | 'optional' | 'complete';
type StepName = 'workflow';

interface TestAgentContext extends BaseAgentContext<string, string> {
  readonly trace: string[];
  readonly observedContexts: Set<TestAgentContext>;
}

type TestWorkflowContext = BaseWorkflowContext<StepName, TestAgentContext, string>;

const TEST_IDENTITY = defineAgentIdentity({ id: 'agent', displayName: 'Test Agent' });

interface TestConfig {
  readonly prefix: string;
}

interface TestResources {
  readonly observedContexts: Set<TestAgentContext>;
}

function workflow(
  name: WorkflowName,
  options: Partial<
    Pick<WorkflowDefinition<StepName, TestAgentContext, TestWorkflowContext, string>, 'condition'>
  > = {}
): Workflow<StepName, TestAgentContext, TestWorkflowContext, string> {
  return new Workflow({
    name,
    entryStep: 'workflow',
    stepDefinitions: {
      workflow: {
        step: (context) => {
          context.result = `${name}:${context.agentContext.input}`;
          return Promise.resolve();
        },
        skippable: false,
      },
    },
    createContext: (base) => ({ ...base }),
    ...(options.condition === undefined ? {} : { condition: options.condition }),
    applyResult: (context, result) => {
      context.observedContexts.add(context);
      context.trace.push(result);
      context.output = `${context.trace.join('|')}`;
      return Promise.resolve();
    },
  });
}

function createTestAgent(
  workflowOverrides: WorkflowOverrides<WorkflowName, TestAgentContext> = {},
  definitionOverrides: Partial<
    AgentDefinition<WorkflowName, string, string, TestConfig, TestResources, TestAgentContext>
  > = {}
): Agent<WorkflowName, string, string, TestConfig, TestResources, TestAgentContext> {
  const resources: TestResources = { observedContexts: new Set() };

  return new Agent({
    identity: TEST_IDENTITY,
    config: { prefix: 'unused' },
    resources,
    workflowPlan: ['first', 'conditional', 'optional', 'complete'],
    workflowDefinitions: {
      first: { workflow: workflow('first'), skippable: false },
      conditional: {
        workflow: workflow('conditional', {
          condition: (context) =>
            Promise.resolve(
              context.input === 'skip-conditional'
                ? skipWorkflow('condition not met')
                : RUN_WORKFLOW
            ),
        }),
        skippable: true,
      },
      optional: { workflow: workflow('optional'), skippable: true },
      complete: { workflow: workflow('complete'), skippable: false },
    },
    workflowOverrides,
    createContext: (base) => ({
      ...base,
      trace: [],
      observedContexts: base.resources.observedContexts,
    }),
    ...definitionOverrides,
  });
}

function expectDefinitionError(run: () => unknown, code: AgentDefinitionError['code']): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected AgentDefinitionError with code ${code}.`);
}

describe('Agent', () => {
  it('runs an explicit default Workflow plan in order', async () => {
    const agent = createTestAgent({ optional: SKIP_WORKFLOW });

    expect(agent.identity).toEqual(TEST_IDENTITY);
    expect(agent.agentId).toBe(TEST_IDENTITY.id);
    expect(Object.isFrozen(agent.identity)).toBe(true);
    await expect(agent.run('hello')).resolves.toBe('first:hello|conditional:hello|complete:hello');
  });

  it('supports an Agent-level custom plan', async () => {
    const agent = createTestAgent();

    await expect(agent.runPlan('hello', ['first', 'complete'])).resolves.toBe(
      'first:hello|complete:hello'
    );
  });

  it('supports running one selected Workflow', async () => {
    const agent = createTestAgent();

    await expect(agent.runWorkflow('hello', 'first')).resolves.toBe('first:hello');
  });

  it('distinguishes internal Workflow conditions from configuration skip', async () => {
    const agent = createTestAgent({ optional: SKIP_WORKFLOW });

    await expect(agent.run('skip-conditional')).resolves.toBe(
      'first:skip-conditional|complete:skip-conditional'
    );
  });

  it('allows a Workflow implementation override', async () => {
    const replacement = workflow('optional');
    const agent = createTestAgent({ optional: replacement });

    await expect(agent.runPlan('hello', ['optional'])).resolves.toBe('optional:hello');
  });

  it('creates isolated Agent Contexts for concurrent runs', async () => {
    const agent = createTestAgent({ optional: SKIP_WORKFLOW });

    await Promise.all([agent.run('first-run'), agent.run('second-run')]);

    expect(agent.resources.observedContexts.size).toBe(2);
    const contexts = [...agent.resources.observedContexts];
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(contexts.map((context) => context.input).sort()).toEqual(['first-run', 'second-run']);
  });

  it('rejects a required Workflow configuration skip during Agent creation', () => {
    expectDefinitionError(
      () => createTestAgent({ first: SKIP_WORKFLOW }),
      'WORKFLOW_NOT_SKIPPABLE'
    );
  });

  it('rejects unknown Workflows in the default plan during Agent creation', () => {
    expectDefinitionError(
      () => createTestAgent({}, { workflowPlan: ['unknown' as WorkflowName] }),
      'WORKFLOW_PLAN_UNKNOWN'
    );
  });

  it('rejects unknown Workflows in a per-run plan', async () => {
    const agent = createTestAgent();

    await expect(agent.runPlan('hello', ['unknown' as WorkflowName])).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_REGISTERED',
    });
  });

  it('rejects an Agent Context factory that replaces runtime-owned fields', async () => {
    const agent = createTestAgent(
      {},
      {
        createContext: (base) => ({
          ...base,
          identity: defineAgentIdentity({ id: 'replacement' }),
          trace: [],
          observedContexts: base.resources.observedContexts,
        }),
      }
    );

    await expect(agent.run('hello')).rejects.toMatchObject({
      code: 'AGENT_CONTEXT_BASE_REPLACED',
    });
  });

  it('requires the selected plan to produce Agent output', async () => {
    const noOutput = new Workflow<StepName, TestAgentContext, TestWorkflowContext, string>({
      name: 'first',
      entryStep: 'workflow',
      stepDefinitions: {
        workflow: {
          step: (context) => {
            context.result = 'result';
            return Promise.resolve();
          },
          skippable: false,
        },
      },
      createContext: (base) => ({ ...base }),
      applyResult: () => Promise.resolve(),
    });
    const agent = createTestAgent({ first: noOutput });

    await expect(agent.runWorkflow('hello', 'first')).rejects.toMatchObject({
      code: 'AGENT_OUTPUT_MISSING',
    });
  });
});
