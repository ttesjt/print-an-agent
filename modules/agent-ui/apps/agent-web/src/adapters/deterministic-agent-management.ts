import type {
  AgentDetails,
  AgentManagementResult,
  AgentRevision,
  AgentSnapshot,
  AgentSummary,
  ChangeAgentLifecycleInput,
  CreateAgentInput,
  InspectAgentInput,
  ListAgentsOptions,
  ReadAgentConfigInput,
  UpdateAgentConfigInput,
} from '@ta-agent/ui-contracts';

import type { AgentManagementPort } from '../application/ports.js';
import type { AgentWebConfig } from '../application/agent-config.js';
import { DEFAULT_AGENT_CONFIG } from '../application/agent-config.js';
import {
  AgentConfigValidationError,
  defineAgentWebConfig,
} from '../application/agent-config-validation.js';

export type { AgentWebConfig, AgentResponseStyle } from '../application/agent-config.js';

export type DeterministicAgentManagement = AgentManagementPort<AgentWebConfig>;

interface MutableAgentRecord {
  config: AgentWebConfig;
  configRevision: number;
  createdAt: string;
  displayName: string;
  identityRevision: number;
  status: AgentDetails['status'];
  updatedAt: string;
}

const INITIAL_TIME = Date.parse('2026-01-01T00:00:00.000Z');

export function createDeterministicAgentManagement(): DeterministicAgentManagement {
  const records = new Map<string, MutableAgentRecord>([
    [
      'research-assistant',
      {
        config: {
          ...DEFAULT_AGENT_CONFIG,
          model: { kind: 'engine', engineId: 'agent-web.offline' },
          instructions: 'Research carefully and cite evidence.',
          responseStyle: 'balanced',
        },
        configRevision: 1,
        createdAt: new Date(INITIAL_TIME).toISOString(),
        displayName: 'Research Assistant',
        identityRevision: 1,
        status: 'active',
        updatedAt: new Date(INITIAL_TIME).toISOString(),
      },
    ],
    [
      'review-assistant',
      {
        config: {
          ...DEFAULT_AGENT_CONFIG,
          model: { kind: 'engine', engineId: 'agent-web.offline' },
          instructions: 'Review changes for correctness.',
          responseStyle: 'concise',
        },
        configRevision: 1,
        createdAt: new Date(INITIAL_TIME + 1_000).toISOString(),
        displayName: 'Review Assistant',
        identityRevision: 1,
        status: 'disabled',
        updatedAt: new Date(INITIAL_TIME + 1_000).toISOString(),
      },
    ],
  ]);
  let logicalClock = 2;
  const now = () => new Date(INITIAL_TIME + logicalClock++ * 1_000).toISOString();

  const management: DeterministicAgentManagement = {
    renameAgent: (input) =>
      defer(() => {
        input.signal?.throwIfAborted();
        const record = records.get(input.agentId);
        if (record === undefined) return failed('not-found', 'Agent not found.');
        if (revision(record.identityRevision) !== input.expectedRevision)
          return conflict(
            revision(record.identityRevision),
            'Agent identity changed. Reload current identity.'
          );
        if (input.displayName.trim().length === 0)
          return {
            status: 'failed',
            failure: {
              code: 'validation-failed',
              message: 'Display name is required.',
              fieldErrors: [{ field: 'displayName', message: 'Enter a display name.' }],
            },
          };
        record.displayName = input.displayName;
        record.identityRevision++;
        record.updatedAt = now();
        return succeeded(details(input.agentId, record));
      }),
    inspectModel: (input) =>
      defer(() => {
        const inspected = inspect(records, input);
        if (inspected.status === 'failed') return inspected;
        return succeeded({
          revision: inspected.value.config.revision,
          status:
            inspected.value.config.value.model.kind === 'unconfigured'
              ? ('unconfigured' as const)
              : ('engine' as const),
          label: 'Explicit deterministic demonstration',
        });
      }),
    testModelConnection: (input) =>
      defer(() => {
        input.signal?.throwIfAborted();
        return failed(
          'unavailable',
          'Connection testing is not available in deterministic fixture mode.'
        );
      }),
    createAgent: (input: CreateAgentInput<AgentWebConfig>) =>
      defer(() => {
        input.signal?.throwIfAborted();
        const validation = validateCreation(input);
        if (validation !== undefined) return validation;
        if (records.has(input.identity.agentId)) {
          return failed('already-exists', 'An Agent with this ID already exists.');
        }

        const timestamp = now();
        records.set(input.identity.agentId, {
          config: freezeConfig(input.config),
          configRevision: 1,
          createdAt: timestamp,
          displayName: input.identity.displayName,
          identityRevision: 1,
          status: 'active',
          updatedAt: timestamp,
        });
        return succeeded(snapshot(input.identity.agentId, records.get(input.identity.agentId)));
      }),
    disableAgent: (input: ChangeAgentLifecycleInput) =>
      defer(() => changeLifecycle(records, input, 'disabled', now)),
    inspectAgent: (input: InspectAgentInput) => defer(() => inspect(records, input)),
    listAgents: (options = {}) => defer(() => list(records, options)),
    reactivateAgent: (input: ChangeAgentLifecycleInput) =>
      defer(() => changeLifecycle(records, input, 'active', now)),
    readAgentConfig: (input: ReadAgentConfigInput) => defer(() => readConfig(records, input)),
    updateAgentConfig: (input: UpdateAgentConfigInput<AgentWebConfig>) =>
      defer(() => updateConfig(records, input)),
  };
  return Object.freeze(management);
}

function defer<Value>(operation: () => Value): Promise<Value> {
  return Promise.resolve().then(operation);
}

function list(
  records: ReadonlyMap<string, MutableAgentRecord>,
  options: ListAgentsOptions
): AgentManagementResult<readonly AgentSummary[]> {
  options.signal?.throwIfAborted();
  const agents = [...records.entries()]
    .map(([agentId, record]) => summary(agentId, record))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  return succeeded(Object.freeze(agents));
}

function inspect(
  records: ReadonlyMap<string, MutableAgentRecord>,
  input: InspectAgentInput
): AgentManagementResult<AgentSnapshot<AgentWebConfig>> {
  input.signal?.throwIfAborted();
  const record = records.get(input.agentId);
  return record === undefined
    ? failed('not-found', 'The selected Agent no longer exists.')
    : succeeded(snapshot(input.agentId, record));
}

function readConfig(records: ReadonlyMap<string, MutableAgentRecord>, input: ReadAgentConfigInput) {
  input.signal?.throwIfAborted();
  const record = records.get(input.agentId);
  return record === undefined
    ? failed('not-found', 'The selected Agent no longer exists.')
    : succeeded(configSnapshot(input.agentId, record));
}

function updateConfig(
  records: Map<string, MutableAgentRecord>,
  input: UpdateAgentConfigInput<AgentWebConfig>
) {
  input.signal?.throwIfAborted();
  const record = records.get(input.agentId);
  if (record === undefined) return failed('not-found', 'The selected Agent no longer exists.');
  const currentRevision = revision(record.configRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'The Agent configuration changed after it was loaded.');
  }
  const fieldErrors = validateConfig(input.config);
  if (fieldErrors.length > 0) {
    return validationFailed(fieldErrors, 'The Agent configuration is invalid.');
  }

  record.config = freezeConfig(input.config);
  record.configRevision += 1;
  return succeeded(configSnapshot(input.agentId, record));
}

function changeLifecycle(
  records: Map<string, MutableAgentRecord>,
  input: ChangeAgentLifecycleInput,
  target: AgentDetails['status'],
  now: () => string
) {
  input.signal?.throwIfAborted();
  const record = records.get(input.agentId);
  if (record === undefined) return failed('not-found', 'The selected Agent no longer exists.');
  const currentRevision = revision(record.identityRevision);
  if (input.expectedRevision !== currentRevision) {
    return conflict(currentRevision, 'The Agent lifecycle changed after it was loaded.');
  }
  if (record.status === target) {
    return failed('invalid-transition', `The Agent is already ${target}.`);
  }

  record.status = target;
  record.identityRevision += 1;
  record.updatedAt = now();
  return succeeded(details(input.agentId, record));
}

function validateCreation(
  input: CreateAgentInput<AgentWebConfig>
): AgentManagementResult<AgentSnapshot<AgentWebConfig>> | undefined {
  const fieldErrors = [
    ...(input.identity.agentId.trim().length === 0
      ? [{ field: 'agentId', message: 'Agent ID is required.' }]
      : []),
    ...(input.identity.displayName.trim().length === 0
      ? [{ field: 'displayName', message: 'Display name is required.' }]
      : []),
    ...validateConfig(input.config),
  ];
  return fieldErrors.length > 0
    ? validationFailed(fieldErrors, 'The Agent definition is invalid.')
    : undefined;
}

function validateConfig(config: AgentWebConfig) {
  try {
    defineAgentWebConfig(config);
    return [];
  } catch (error) {
    if (error instanceof AgentConfigValidationError) return error.fieldErrors;
    throw error;
  }
}

function summary(agentId: string, record: MutableAgentRecord): AgentSummary {
  return Object.freeze({
    agentId,
    displayName: record.displayName,
    identityRevision: revision(record.identityRevision),
    status: record.status,
    updatedAt: record.updatedAt,
  });
}

function details(agentId: string, record: MutableAgentRecord): AgentDetails {
  return Object.freeze({ ...summary(agentId, record), createdAt: record.createdAt });
}

function configSnapshot(agentId: string, record: MutableAgentRecord) {
  return Object.freeze({
    agentId,
    revision: revision(record.configRevision),
    value: freezeConfig(record.config),
  });
}

function snapshot(agentId: string, record: MutableAgentRecord | undefined) {
  if (record === undefined) throw new Error('Deterministic Agent record was not created.');
  return Object.freeze({
    config: configSnapshot(agentId, record),
    details: details(agentId, record),
  });
}

function revision(value: number): AgentRevision {
  return `revision-${String(value)}`;
}

function freezeConfig(config: AgentWebConfig): AgentWebConfig {
  return defineAgentWebConfig(config);
}

function succeeded<Value>(value: Value): AgentManagementResult<Value> {
  return Object.freeze({ status: 'succeeded', value });
}

function failed(
  code: 'already-exists' | 'invalid-transition' | 'not-found' | 'operation-failed' | 'unavailable',
  message: string
): AgentManagementResult<never> {
  return Object.freeze({ status: 'failed', failure: Object.freeze({ code, message }) });
}

function conflict(currentRevision: AgentRevision, message: string): AgentManagementResult<never> {
  return Object.freeze({
    status: 'failed',
    failure: Object.freeze({ code: 'revision-conflict', currentRevision, message }),
  });
}

function validationFailed(
  fieldErrors: readonly { readonly field: string; readonly message: string }[],
  message: string
): AgentManagementResult<never> {
  return Object.freeze({
    status: 'failed',
    failure: Object.freeze({
      code: 'validation-failed',
      fieldErrors: Object.freeze([...fieldErrors]),
      message,
    }),
  });
}
