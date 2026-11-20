import type {
  AppliedSessionNavigation,
  ApplySessionNavigationRequest,
} from '../../navigation/index.js';
import type { SessionMemoryPort } from './records.js';

/** Atomically publishes Session navigation, its branch binding and its coordination receipt. */
export interface PublishSessionMemoryNavigation extends ApplySessionNavigationRequest {
  readonly intentId: string;
  readonly expectedIntentRevision: number;
  readonly binding?: Readonly<{ id: string; value: string }>;
}

export interface SessionMemoryNavigationPort extends SessionMemoryPort {
  publishMemoryNavigation(input: PublishSessionMemoryNavigation): Promise<AppliedSessionNavigation>;
}
