import { randomUUID } from 'node:crypto';
import { defineAgentIdentity } from '@ta-agent/base-identity';
import type { AgentId, AgentIdentity } from '@ta-agent/base-identity';
import type { AgentDefinition, AgentRunOptions, RunnableAgent } from '../types/agent.js';
import type { BaseAgentContext } from '../types/context.js';
import { AgentDefinitionError, AgentRunError } from '../types/errors.js';
import type { WorkflowName } from '../types/workflow.js';
import type { ResolvedWorkflowRegistry } from '../types/workflow-registry.js';
import { resolveWorkflowRegistry } from './workflow-registry.js';

export class Agent<
  TWorkflowName extends WorkflowName,
  TInput,
  TOutput,
  TConfig,
  TResources,
  C extends BaseAgentContext<TInput, TOutput>,
> implements RunnableAgent<TWorkflowName, TInput, TOutput> {
  readonly identity: AgentIdentity;
  readonly config: TConfig;
  readonly resources: TResources;
  readonly workflowPlan: readonly TWorkflowName[];

  readonly #workflows: ResolvedWorkflowRegistry<TWorkflowName, C>;
  readonly #createContext: AgentDefinition<
    TWorkflowName,
    TInput,
    TOutput,
    TConfig,
    TResources,
    C
  >['createContext'];
  readonly #createRunId: () => string;

  constructor(definition: AgentDefinition<TWorkflowName, TInput, TOutput, TConfig, TResources, C>) {
    this.identity = defineAgentIdentity(definition.identity);
    this.config = definition.config;
    this.resources = definition.resources;
    this.workflowPlan = Object.freeze([...definition.workflowPlan]);
    this.#workflows = resolveWorkflowRegistry(
      definition.workflowDefinitions,
      definition.workflowOverrides
    );
    this.#createContext = definition.createContext;
    this.#createRunId = definition.createRunId ?? randomUUID;

    for (const workflowName of this.workflowPlan) {
      if (this.#workflows[workflowName] === undefined) {
        throw new AgentDefinitionError(
          'WORKFLOW_PLAN_UNKNOWN',
          workflowName,
          `Default workflow plan references unregistered workflow "${workflowName}".`
        );
      }
    }
  }

  get agentId(): AgentId {
    return this.identity.id;
  }

  async run(input: TInput, options: AgentRunOptions<TWorkflowName> = {}): Promise<TOutput> {
    const workflowPlan = options.workflowPlan ?? this.workflowPlan;
    const signal = options.signal ?? new AbortController().signal;
    const runId = this.#createRunId();
    const context = this.#createContext({
      identity: this.identity,
      runId,
      input,
      signal,
      config: this.config,
      resources: this.resources,
    });

    if (
      context.identity !== this.identity ||
      context.runId !== runId ||
      context.input !== input ||
      context.signal !== signal
    ) {
      throw new AgentRunError(
        'AGENT_CONTEXT_BASE_REPLACED',
        `Agent Context factory for "${this.agentId}" replaced runtime-owned base fields.`,
        this.agentId
      );
    }

    for (const workflowName of workflowPlan) {
      const resolved = this.#workflows[workflowName];
      if (resolved === undefined) {
        throw new AgentRunError(
          'WORKFLOW_NOT_REGISTERED',
          `Workflow "${workflowName}" is not registered for agent "${this.agentId}".`,
          workflowName
        );
      }
      if (resolved.status === 'skipped') continue;

      const outcome = await resolved.workflow.run(context);
      if (outcome.status === 'completed') {
        await outcome.applyTo(context);
      }
    }

    if (!Object.hasOwn(context, 'output')) {
      throw new AgentRunError(
        'AGENT_OUTPUT_MISSING',
        `Agent "${this.agentId}" completed its workflow plan without assigning context.output.`,
        this.agentId
      );
    }

    return context.output as TOutput;
  }

  runPlan(
    input: TInput,
    workflowPlan: readonly TWorkflowName[],
    options: Omit<AgentRunOptions<TWorkflowName>, 'workflowPlan'> = {}
  ): Promise<TOutput> {
    return this.run(input, { ...options, workflowPlan });
  }

  runWorkflow(
    input: TInput,
    workflowName: TWorkflowName,
    options: Omit<AgentRunOptions<TWorkflowName>, 'workflowPlan'> = {}
  ): Promise<TOutput> {
    return this.runPlan(input, [workflowName], options);
  }
}

export function createAgent<
  TWorkflowName extends WorkflowName,
  TInput,
  TOutput,
  TConfig,
  TResources,
  C extends BaseAgentContext<TInput, TOutput>,
>(
  definition: AgentDefinition<TWorkflowName, TInput, TOutput, TConfig, TResources, C>
): Agent<TWorkflowName, TInput, TOutput, TConfig, TResources, C> {
  return new Agent(definition);
}
