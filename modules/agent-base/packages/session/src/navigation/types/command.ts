import type { SessionBranchId, TurnId } from '../../contracts/index.js';

export type SessionNavigationOperation = 'inspect' | 'select' | 'fork' | 'rewind';

export type NavigateSessionInput =
  | Readonly<{ sessionId: string; operation: 'inspect' }>
  | Readonly<{
      sessionId: string;
      operation: 'select';
      branchId: string;
      expectedRevision: number;
    }>
  | Readonly<{
      sessionId: string;
      operation: 'fork';
      sourceBranchId: string;
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>
  | Readonly<{
      sessionId: string;
      operation: 'rewind';
      throughTurnId: string;
      newBranchId?: string;
      expectedRevision: number;
    }>;

export type ValidatedSessionNavigationCommand =
  | Readonly<{ operation: 'inspect' }>
  | Readonly<{
      operation: 'select';
      branchId: SessionBranchId;
      expectedRevision: number;
    }>
  | Readonly<{
      operation: 'fork';
      sourceBranchId: SessionBranchId;
      throughTurnId: TurnId;
      newBranchId?: SessionBranchId;
      expectedRevision: number;
    }>
  | Readonly<{
      operation: 'rewind';
      throughTurnId: TurnId;
      newBranchId?: SessionBranchId;
      expectedRevision: number;
    }>;

export type MutatingSessionNavigationCommand = Exclude<
  ValidatedSessionNavigationCommand,
  Readonly<{ operation: 'inspect' }>
>;
