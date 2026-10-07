import type { ConversationInteractionEvent } from '@ta-agent/ui-contracts';
import type { AgentWebConfig } from '../application/agent-config.js';
import { AGENT_CONFIG_DECODER } from '../application/agent-config-validation.js';
import {
  array,
  integer,
  literal,
  object,
  optional,
  text,
  union,
  fail,
  type Decoder,
} from './decoder.js';

export const id = text(256, 1);
export const revision = text(128, 1);
const timestamp: Decoder<string> = {
  decode: (input) => {
    const value = text(64, 1).decode(input);
    if (!Number.isFinite(Date.parse(value))) return fail();
    return value;
  },
};
export const config: Decoder<AgentWebConfig> = AGENT_CONFIG_DECODER;
export const modelStatus = object({
  revision,
  status: union(
    literal('unconfigured'),
    literal('configured'),
    literal('credential-unavailable'),
    literal('engine')
  ),
  label: text(512, 1),
});
export const modelConnection = object({ revision, checkedAt: timestamp });
const summaryFields = {
  agentId: id,
  displayName: text(256, 1),
  identityRevision: revision,
  status: union(literal('active'), literal('disabled')),
  updatedAt: timestamp,
};
export const agentSummary = object(summaryFields);
export const agentDetails = object({ ...summaryFields, createdAt: timestamp });
export const configSnapshot = object({ agentId: id, revision, value: config });
export const agentSnapshot = object({ details: agentDetails, config: configSnapshot });
const fieldErrors = array(object({ field: text(256, 1), message: text(4096, 1) }), 100);
const conflict = object({
  code: literal('revision-conflict'),
  currentRevision: revision,
  message: text(4096, 1),
});
const validation = object({
  code: literal('validation-failed'),
  fieldErrors,
  message: text(4096, 1),
});
export const agentFailure = union(
  conflict,
  validation,
  object({
    code: union(
      literal('already-exists'),
      literal('invalid-transition'),
      literal('not-found'),
      literal('operation-failed'),
      literal('unavailable')
    ),
    message: text(4096, 1),
  })
);
export const sessionFailure = union(
  conflict,
  validation,
  object({
    code: union(
      literal('invalid-transition'),
      literal('not-found'),
      literal('operation-failed'),
      literal('session-busy'),
      literal('unavailable')
    ),
    message: text(4096, 1),
  })
);
export const conversationFailure = object({
  code: union(
    literal('interaction-failed'),
    literal('invalid-stream'),
    literal('not-found'),
    literal('operation-failed'),
    literal('session-busy'),
    literal('unavailable')
  ),
  message: text(4096, 1),
});
export function result<T, F>(value: Decoder<T>, failure: Decoder<F>) {
  return union(
    object({ status: literal('succeeded'), value }),
    object({ status: literal('failed'), failure })
  );
}
const sessionFields = {
  agentId: id,
  sessionId: id,
  selectedBranchId: id,
  metadataRevision: revision,
  navigationRevision: revision,
  branchCount: integer(1),
  turnCount: integer(),
  title: optional(text(256)),
  createdAt: timestamp,
  updatedAt: timestamp,
};
export const session = union(
  object({ ...sessionFields, status: literal('active') }),
  object({ ...sessionFields, status: literal('retired'), retiredAt: timestamp })
);
export const sessionPage = object({
  records: array(session, 200),
  nextCursor: optional(text(2048, 1)),
});
export const navigation = object({
  agentId: id,
  sessionId: id,
  revision,
  selectedBranchId: id,
  branches: array(
    object({
      branchId: id,
      createdAt: timestamp,
      parentBranchId: optional(id),
      forkedFromTurnId: optional(id),
      headTurnId: optional(id),
    })
  ),
});
export const branchMutation = object({ affectedBranchId: id, navigation });
const userMessage = object({ text: text(), timestamp });
const reasoningBlock = object({ modelTurnIndex: integer(1), text: text() });
const toolActivity = object({
  callId: id,
  modelTurnIndex: integer(1),
  toolLabel: text(256, 1),
  status: union(literal('pending'), literal('success'), literal('error')),
  summary: optional(text(4096)),
  details: array(object({ label: text(256), value: text(4096) }), 100),
});
const turnFields = { branchId: id, turnId: id, userMessage };
export const completedTurn = object({
  ...turnFields,
  status: literal('completed'),
  assistantMessage: object({
    text: text(),
    timestamp,
    reasoningBlocks: array(reasoningBlock),
    toolActivities: array(toolActivity),
  }),
});
const failedTurn = object({
  ...turnFields,
  status: literal('failed'),
  failure: conversationFailure,
});
export const conversationPage = object({
  turns: array(union(completedTurn, failedTurn), 200),
  nextCursor: optional(id),
});
const eventFields = { interactionId: id };
export const interactionEvent: Decoder<ConversationInteractionEvent> = union(
  object({ ...eventFields, type: literal('interaction-started') }),
  object({
    ...eventFields,
    type: literal('session-admitted'),
    admission: object({ details: session, navigation }),
  }),
  object({
    ...eventFields,
    type: literal('text-delta'),
    delta: text(),
    modelTurnIndex: integer(1),
  }),
  object({
    ...eventFields,
    type: literal('reasoning-delta'),
    delta: text(),
    modelTurnIndex: integer(1),
  }),
  object({ ...eventFields, type: literal('tool-activity-updated'), activity: toolActivity }),
  object({ ...eventFields, type: literal('completed'), sessionId: id, turn: completedTurn }),
  object({ ...eventFields, type: literal('failed'), failure: conversationFailure }),
  object({ ...eventFields, type: literal('cancelled') })
);
export const interactionInput = object({
  agentId: id,
  interactionId: id,
  message: text(64_000, 1),
  session: optional(object({ sessionId: id, branchId: id, navigationRevision: revision })),
});
