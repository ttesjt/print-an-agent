/** Browser-safe application schema; no provider SDK types or executable adapters. */
export interface AgentWebConfig {
  readonly instructions: string;
  readonly responseStyle: AgentResponseStyle;
  readonly model: AgentModelBinding;
  readonly invocation: Readonly<{ temperature: number | null; maxOutputTokens: number | null }>;
  readonly execution: AgentExecutionSettings;
}

export type AgentResponseStyle = 'balanced' | 'concise';
export interface AgentConfigFieldErrors {
  readonly [field: string]: string | undefined;
}
export interface AgentCredentialBinding {
  readonly reference: string;
  readonly environmentVariable: string;
}
export interface AgentModelReference {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialRef?: string;
}
export type AgentProviderConfig =
  | Readonly<{ kind: 'builtin'; reference: AgentModelReference }>
  | Readonly<{
      kind: 'openai-compatible';
      reference: AgentModelReference;
      contextWindowTokens: number;
      maxOutputTokens: number;
      supportsReasoning: boolean;
      compatibility: Readonly<{ supportsDeveloperRole: boolean }>;
    }>;
export type AgentModelBinding =
  | Readonly<{ kind: 'unconfigured' }>
  | Readonly<{
      kind: 'provider';
      config: AgentProviderConfig;
      credential: AgentCredentialBinding | null;
    }>
  | Readonly<{ kind: 'engine'; engineId: string }>;
export interface AgentExecutionSettings {
  readonly requestTimeoutMilliseconds: number | null;
  readonly actorTimeoutMilliseconds: number | null;
  readonly responseStartTimeoutMilliseconds: number | null;
  readonly streamEventIdleTimeoutMilliseconds: number | null;
}
export const DEFAULT_AGENT_CONFIG: AgentWebConfig = Object.freeze({
  instructions: 'Help the user clearly and accurately.',
  responseStyle: 'balanced',
  model: Object.freeze({ kind: 'unconfigured' }),
  invocation: Object.freeze({ temperature: null, maxOutputTokens: null }),
  execution: Object.freeze({
    requestTimeoutMilliseconds: null,
    actorTimeoutMilliseconds: null,
    responseStartTimeoutMilliseconds: null,
    streamEventIdleTimeoutMilliseconds: null,
  }),
});
export interface AgentModelStatus {
  readonly revision: string;
  readonly status: 'unconfigured' | 'configured' | 'credential-unavailable' | 'engine';
  readonly label: string;
}
