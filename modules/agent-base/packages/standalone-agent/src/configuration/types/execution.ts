import type { RequestPolicy } from '@print-an-agent/base-request';
import type { SessionCompactionPolicy } from '@print-an-agent/base-session';

export interface StandaloneRequestExecutionConfigInput {
  readonly timeoutMilliseconds: RequestPolicy['timeoutMilliseconds'];
}

export interface StandaloneRequestExecutionConfig {
  readonly timeoutMilliseconds: RequestPolicy['timeoutMilliseconds'];
}

export type StandaloneSessionCompactionExecutionConfigInput = Readonly<
  Partial<Omit<SessionCompactionPolicy, 'timeoutMilliseconds'>> &
    Pick<SessionCompactionPolicy, 'timeoutMilliseconds'>
>;

export type StandaloneSessionCompactionExecutionConfig = SessionCompactionPolicy;
