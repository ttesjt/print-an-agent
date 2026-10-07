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
import type { DemoAgentConfig } from '../application/demo-agent-config.js';

export type { DemoAgentConfig, DemoResponseStyle } from '../application/demo-agent-config.js';

export type DeterministicAgentManagement = AgentManagementPort<DemoAgentConfig>;

interface MutableAgentRecord {
  config: DemoAgentConfig;
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
        config: { instructions: 'Review changes for correctness.', responseStyle: 'concise' },
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

  return Object.freeze({
    createAgent: (input: CreateAgentInput<DemoAgentConfig>) =>
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
    updateAgentConfig: (input: UpdateAgentConfigInput<DemoAgentConfig>) =>
      defer(() => updateConfig(records, input)),
  });
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
): AgentManagementResult<AgentSnapshot<DemoAgentConfig>> {
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
  input: UpdateAgentConfigInput<DemoAgentConfig>
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
  input: CreateAgentInput<DemoAgentConfig>
): AgentManagementResult<AgentSnapshot<DemoAgentConfig>> | undefined {
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

function validateConfig(config: DemoAgentConfig) {
  return config.instructions.trim().length === 0
    ? Object.freeze([{ field: 'instructions', message: 'Instructions are required.' }])
    : Object.freeze([]);
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

function freezeConfig(config: DemoAgentConfig): DemoAgentConfig {
  return Object.freeze({ instructions: config.instructions, responseStyle: config.responseStyle });
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
