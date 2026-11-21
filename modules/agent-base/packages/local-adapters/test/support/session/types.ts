import {
  type NavigableCompactableSessionPort,
  type SessionMetadataPort,
  type SessionQueryPort,
} from '@print-an-agent/base-session';

export interface SessionPortContractHarness {
  readonly adapter: NavigableCompactableSessionPort & SessionQueryPort & SessionMetadataPort;
  readonly dispose?: () => void;
}
