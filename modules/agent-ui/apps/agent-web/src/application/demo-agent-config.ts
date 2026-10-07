/** Application-owned configuration shape used by the current walking skeleton. */
export interface DemoAgentConfig {
  readonly instructions: string;
  readonly responseStyle: DemoResponseStyle;
}

export type DemoResponseStyle = 'balanced' | 'concise';
