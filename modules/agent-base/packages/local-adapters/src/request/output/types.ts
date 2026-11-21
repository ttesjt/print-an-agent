import type {
  AgentResponse,
  OutputFailure,
  OutputOpenEvent,
  OutputStreamEvent,
} from '@print-an-agent/base-request';

export type MemoryOutputSnapshot =
  | Readonly<{ status: 'pending'; events: readonly OutputStreamEvent[] }>
  | Readonly<{
      status: 'open';
      openEvent: OutputOpenEvent;
      events: readonly OutputStreamEvent[];
    }>
  | Readonly<{
      status: 'closed';
      openEvent: OutputOpenEvent;
      events: readonly OutputStreamEvent[];
      response: AgentResponse;
    }>
  | Readonly<{
      status: 'failed';
      openEvent?: OutputOpenEvent;
      events: readonly OutputStreamEvent[];
      failure: OutputFailure;
    }>;
