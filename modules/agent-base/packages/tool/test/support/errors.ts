import { expect } from 'vitest';
import { AgentToolError } from '../../src/index.js';

export function expectAgentToolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected AgentToolError with code ${code}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentToolError);
    if (!(error instanceof AgentToolError)) return;
    expect(error.code).toBe(code);
  }
}
