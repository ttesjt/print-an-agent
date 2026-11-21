import type {
  ToolCallProposal,
  ToolDescriptor,
  ToolExecutionOptions,
  ToolExecutionOutcome,
  ToolObjectSchema,
  ToolSchemaValue,
} from '@print-an-agent/model-invocation-core';
import type { ToolDefinition } from '../definition/index.js';
import { parseToolArguments, parseToolName } from '../definition/index.js';
import { AgentToolError } from '../errors.js';
import { resolveEffectiveTools } from '../permissions/index.js';
import type { AgentToolErrorCode } from '../types/errors.js';
import type { ToolCallId, ToolName } from '../types/identity.js';
import { parseToolCallId, serializedCharacterCount } from './call-input.js';
import { executeToolHandler } from './execute-tool-handler.js';
import { validateToolExecutionPolicy } from './execution-policy.js';
import type { ToolRunInspection, ToolRunRecord } from './types/inspection.js';
import type { ToolExecutionPolicy } from './types/policy.js';
import type { CreateBoundedToolRuntimeOptions, ToolRuntime } from './types/runtime.js';

function cloneDescriptor(tool: ToolDefinition): ToolDescriptor {
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  });
}

function cloneRecord(record: ToolRunRecord): ToolRunRecord {
  return Object.freeze({ ...record });
}

interface PreparedToolCall {
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly startedAt: number;
  readonly tool: ToolDefinition;
  readonly arguments: ToolSchemaValue<ToolObjectSchema>;
}

class BoundedToolRuntime implements ToolRuntime {
  readonly tools: readonly ToolDescriptor[];
  readonly #definitions: ReadonlyMap<ToolName, ToolDefinition>;
  readonly #policy: ToolExecutionPolicy;
  readonly #signal: AbortSignal;
  readonly #clock: () => number;
  readonly #seenCallIds = new Set<ToolCallId>();
  readonly #records: ToolRunRecord[] = [];
  #executionTail: Promise<void> = Promise.resolve();
  #totalResultCharacters = 0;
  #closed = false;

  constructor(options: CreateBoundedToolRuntimeOptions) {
    const effective = resolveEffectiveTools(options.registry, options.permissionPolicy);
    this.tools = Object.freeze(effective.map(cloneDescriptor));
    this.#definitions = new Map(effective.map((tool) => [tool.name, tool]));
    this.#policy = validateToolExecutionPolicy(options.executionPolicy);
    this.#signal = options.signal;
    this.#clock = options.clock ?? Date.now;
  }

  execute(
    proposal: ToolCallProposal,
    options: ToolExecutionOptions = {}
  ): Promise<ToolExecutionOutcome> {
    const signal =
      options.signal === undefined ? this.#signal : AbortSignal.any([this.#signal, options.signal]);
    const execution = this.#executionTail.then(() => this.#execute(proposal, signal));
    this.#executionTail = execution.then(
      () => undefined,
      () => undefined
    );
    return execution;
  }

  async #execute(proposal: ToolCallProposal, signal: AbortSignal): Promise<ToolExecutionOutcome> {
    const prepared = this.#prepare(proposal, signal);
    let outcome: ToolExecutionOutcome;
    try {
      outcome = await executeToolHandler(
        signal,
        this.#policy.toolTimeoutMilliseconds,
        (effectiveSignal) =>
          prepared.tool.execute({
            callId: prepared.callId,
            arguments: prepared.arguments,
            signal: effectiveSignal,
          })
      );
    } catch (cause: unknown) {
      const error =
        cause instanceof AgentToolError
          ? cause
          : new AgentToolError(
              'TOOL_RESULT_INVALID',
              'Tool execution failed at the runtime boundary.',
              { cause }
            );
      return this.#reject(
        prepared.callId,
        prepared.toolName,
        prepared.startedAt,
        error.code,
        error.message,
        error
      );
    }
    return this.#complete(prepared.callId, prepared.toolName, prepared.startedAt, outcome);
  }

  #prepare(proposal: ToolCallProposal, signal: AbortSignal): PreparedToolCall {
    if (this.#closed) {
      throw new AgentToolError('TOOL_RUN_CLOSED', 'Tool runtime is closed.');
    }
    if (signal.aborted) {
      throw new AgentToolError('TOOL_EXECUTION_CANCELLED', 'Tool execution was cancelled.');
    }
    const callId = parseToolCallId(proposal.callId);
    const toolName = parseToolName(proposal.toolName);
    const startedAt = this.#clock();
    if (this.#seenCallIds.has(callId)) {
      throw new AgentToolError('TOOL_CALL_DUPLICATE', `Tool call "${callId}" is duplicated.`);
    }
    this.#seenCallIds.add(callId);
    if (this.#seenCallIds.size > this.#policy.maxToolCalls) {
      return this.#reject(
        callId,
        toolName,
        startedAt,
        'TOOL_CALL_BUDGET_EXCEEDED',
        `Tool call budget ${this.#policy.maxToolCalls} was exceeded.`
      );
    }
    const tool = this.#definitions.get(toolName);
    if (tool === undefined) {
      return this.#reject(
        callId,
        toolName,
        startedAt,
        'TOOL_NOT_AUTHORIZED',
        `Tool "${toolName}" is not authorized for this run.`
      );
    }
    if (serializedCharacterCount(proposal.arguments) > this.#policy.maxArgumentCharacters) {
      return this.#reject(
        callId,
        toolName,
        startedAt,
        'TOOL_ARGUMENTS_TOO_LARGE',
        `Tool arguments exceed ${this.#policy.maxArgumentCharacters} characters.`
      );
    }

    let parsedArguments: ToolSchemaValue<ToolObjectSchema>;
    try {
      parsedArguments = parseToolArguments(tool.parameters, proposal.arguments);
    } catch (cause: unknown) {
      const error =
        cause instanceof AgentToolError
          ? cause
          : new AgentToolError('TOOL_ARGUMENTS_INVALID', 'Tool arguments are invalid.', { cause });
      return this.#reject(callId, toolName, startedAt, error.code, error.message, error);
    }
    return Object.freeze({
      callId,
      toolName,
      startedAt,
      tool,
      arguments: parsedArguments,
    });
  }

  close(): void {
    this.#closed = true;
  }

  inspect(): ToolRunInspection {
    return Object.freeze({
      status: this.#closed ? 'closed' : 'open',
      effectiveTools: this.tools,
      records: Object.freeze(this.#records.map(cloneRecord)),
      totalResultCharacters: this.#totalResultCharacters,
    });
  }

  #complete(
    callId: ToolCallId,
    toolName: ToolName,
    startedAt: number,
    outcome: ToolExecutionOutcome
  ): ToolExecutionOutcome {
    if (outcome.text.length > this.#policy.maxResultCharacters) {
      return this.#reject(
        callId,
        toolName,
        startedAt,
        'TOOL_RESULT_TOO_LARGE',
        `Tool result exceeds ${this.#policy.maxResultCharacters} characters.`
      );
    }
    if (this.#totalResultCharacters + outcome.text.length > this.#policy.maxTotalResultCharacters) {
      return this.#reject(
        callId,
        toolName,
        startedAt,
        'TOOL_TOTAL_RESULT_BUDGET_EXCEEDED',
        `Total tool result budget ${this.#policy.maxTotalResultCharacters} was exceeded.`
      );
    }
    this.#totalResultCharacters += outcome.text.length;
    this.#records.push(
      Object.freeze({
        callId,
        toolName,
        status: outcome.status,
        resultCharacters: outcome.text.length,
        startedAt,
        completedAt: this.#clock(),
      })
    );
    return Object.freeze({ ...outcome });
  }

  #reject(
    callId: ToolCallId,
    toolName: ToolName,
    startedAt: number,
    code: AgentToolErrorCode,
    message: string,
    cause?: unknown
  ): never {
    this.#records.push(
      Object.freeze({
        callId,
        toolName,
        status: 'rejected',
        resultCharacters: 0,
        startedAt,
        completedAt: this.#clock(),
        errorCode: code,
      })
    );
    throw new AgentToolError(code, message, cause === undefined ? undefined : { cause });
  }
}

export function createBoundedToolRuntime(options: CreateBoundedToolRuntimeOptions): ToolRuntime {
  return new BoundedToolRuntime(options);
}
