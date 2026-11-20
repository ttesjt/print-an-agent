import {
  BUILT_IN_RESPONSIBILITIES,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
  type ResponsibilityDefinitionInput,
} from '@print-an-agent/base-actor';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  type AssistantModelMessage,
} from '@print-an-agent/model-invocation-core';

export function responsibilitiesAllowingTools(
  allowedTools: readonly string[]
): readonly ResponsibilityDefinitionInput[] {
  return BUILT_IN_RESPONSIBILITIES.map((definition) =>
    definition.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID
      ? { ...definition, allowedTools }
      : definition
  );
}

export function customAssistantMessage(text: string): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.custom-target',
      evidence: { artifactId: 'PRIVATE_ARTIFACT_ID' },
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    timestamp: 1,
  });
}
