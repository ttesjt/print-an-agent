import {
  DEFAULT_TOOL_EXECUTION_POLICY,
  DENY_ALL_TOOL_PERMISSION_POLICY,
  EMPTY_TOOL_REGISTRY,
  defineToolPermissionPolicy,
  validateToolExecutionPolicy,
} from '@print-an-agent/base-tool';
import { AgentRequestError } from '../../errors.js';
import { DEFAULT_REQUEST_POLICY } from '../../policy/index.js';
import { bindGenerationResources } from '../resources.js';
import { closedRecord, defineSessionlessGenerationPolicy } from '../validation.js';
import type {
  BoundSessionlessInteractionResources,
  SessionlessInteractionPolicy,
  SessionlessInteractionResources,
} from './contracts.js';

export function defineSessionlessInteractionPolicy(
  input: unknown = {}
): SessionlessInteractionPolicy {
  const record = closedRecord(
    input,
    [...Object.keys(defineSessionlessGenerationPolicy()), 'maxModelTurns'],
    'REQUEST_POLICY_INVALID'
  );
  const { maxModelTurns, ...generation } = record;
  const turns = Object.hasOwn(record, 'maxModelTurns')
    ? maxModelTurns
    : DEFAULT_REQUEST_POLICY.maxModelTurns;
  if (typeof turns !== 'number' || !Number.isSafeInteger(turns) || turns < 1)
    throw new AgentRequestError(
      'REQUEST_POLICY_INVALID',
      'Interaction model-turn budget must be a positive safe integer.'
    );
  return Object.freeze({ ...defineSessionlessGenerationPolicy(generation), maxModelTurns: turns });
}

export const DEFAULT_SESSIONLESS_INTERACTION_POLICY = defineSessionlessInteractionPolicy();

export function bindInteractionResources(
  input: SessionlessInteractionResources
): BoundSessionlessInteractionResources {
  closedRecord(
    input,
    ['actor', 'policy', 'instructionContributors', 'createOutputSink', 'clock', 'tools'],
    'REQUEST_CONFIGURATION_INVALID'
  );
  const { tools, policy, ...generation } = input;
  const resolvedPolicy = defineSessionlessInteractionPolicy(policy);
  const base = bindGenerationResources(generation);
  if (tools !== undefined) {
    closedRecord(
      tools,
      ['registry', 'permissionPolicy', 'executionPolicy'],
      'REQUEST_CONFIGURATION_INVALID'
    );
    if (typeof tools.registry?.get !== 'function' || typeof tools.registry.list !== 'function')
      throw new AgentRequestError(
        'REQUEST_CONFIGURATION_INVALID',
        'Interaction tools require a ToolRegistry.'
      );
    if (tools.permissionPolicy !== undefined) {
      const permissions = closedRecord(
        tools.permissionPolicy,
        ['responsibility', 'actor', 'product', 'runtime'],
        'REQUEST_CONFIGURATION_INVALID'
      );
      for (const key of ['responsibility', 'actor', 'product', 'runtime']) {
        const value = permissions[key];
        if (
          !Array.isArray(value) ||
          Array.from<unknown>(value).some((item) => typeof item !== 'string')
        )
          throw new AgentRequestError(
            'REQUEST_CONFIGURATION_INVALID',
            'Tool authorization requires explicit allow-lists.'
          );
      }
    }
    if (tools.executionPolicy !== undefined) {
      const limits = closedRecord(
        tools.executionPolicy,
        Object.keys(DEFAULT_TOOL_EXECUTION_POLICY),
        'REQUEST_CONFIGURATION_INVALID'
      );
      if (Object.keys(DEFAULT_TOOL_EXECUTION_POLICY).some((key) => !Object.hasOwn(limits, key))) {
        throw new AgentRequestError(
          'REQUEST_CONFIGURATION_INVALID',
          'Tool execution policy is incomplete.'
        );
      }
    }
  }
  return Object.freeze({
    ...base,
    policy: resolvedPolicy,
    toolRegistry: tools?.registry ?? EMPTY_TOOL_REGISTRY,
    toolPermissionPolicy:
      tools?.permissionPolicy === undefined
        ? DENY_ALL_TOOL_PERMISSION_POLICY
        : defineToolPermissionPolicy(tools.permissionPolicy),
    toolExecutionPolicy: validateToolExecutionPolicy(
      tools?.executionPolicy ?? DEFAULT_TOOL_EXECUTION_POLICY
    ),
  });
}
