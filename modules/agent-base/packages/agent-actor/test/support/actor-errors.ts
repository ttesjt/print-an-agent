import { expect } from 'vitest';
import type { AgentActorError } from '@print-an-agent/agent-actor';
export function expectActorError(action: () => unknown, code: AgentActorError['code']): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining({ code }));
}
