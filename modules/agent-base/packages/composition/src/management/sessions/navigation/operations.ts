import type { SessionNavigationOperationOptions } from '@print-an-agent/base-session';
import { assertActive } from './cancellation.js';
import { executeManagedNavigation } from './execute.js';
import {
  normalizeFork,
  normalizeInspect,
  normalizeOptions,
  normalizeRewind,
  normalizeSelect,
} from './input.js';
import { invalidPorts } from './provisioning.js';
import type { SessionNavigationDefinition } from './types/context.js';
import type {
  ForkManagedSessionBranchInput,
  InspectManagedSessionNavigationInput,
  RewindManagedSessionBranchInput,
  SelectManagedSessionBranchInput,
} from './types/input.js';
import type {
  SessionBranchForkOutcome,
  SessionBranchRewindOutcome,
  SessionBranchSelectionOutcome,
  SessionNavigationInspectionOutcome,
} from './types/outcome.js';

export async function inspectManagedSessionNavigation<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: InspectManagedSessionNavigationInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionNavigationInspectionOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'inspect-session-navigation',
    definition,
    normalizeInspect(input),
    options
  );
  if (outcome.status !== 'inspected') {
    return invalidPorts(
      'inspect-session-navigation',
      'Session navigation coordinator returned an invalid inspection outcome.'
    );
  }
  return outcome;
}

export async function selectManagedSessionBranch<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: SelectManagedSessionBranchInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionBranchSelectionOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'select-session-branch',
    definition,
    normalizeSelect(input),
    options
  );
  if (outcome.status !== 'selected') {
    return invalidPorts(
      'select-session-branch',
      'Session navigation coordinator returned an invalid selection outcome.'
    );
  }
  return outcome;
}

export async function forkManagedSessionBranch<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: ForkManagedSessionBranchInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionBranchForkOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'fork-session-branch',
    definition,
    normalizeFork(input),
    options
  );
  if (outcome.status !== 'forked') {
    return invalidPorts(
      'fork-session-branch',
      'Session navigation coordinator returned an invalid fork outcome.'
    );
  }
  return outcome;
}

export async function rewindManagedSessionBranch<TNamespaceHandle>(
  definition: SessionNavigationDefinition<TNamespaceHandle>,
  input: RewindManagedSessionBranchInput,
  optionsInput?: SessionNavigationOperationOptions
): Promise<SessionBranchRewindOutcome> {
  const options = normalizeOptions(optionsInput);
  assertActive(options.signal);
  const outcome = await executeManagedNavigation(
    'rewind-session-branch',
    definition,
    normalizeRewind(input),
    options
  );
  if (outcome.status !== 'rewound') {
    return invalidPorts(
      'rewind-session-branch',
      'Session navigation coordinator returned an invalid rewind outcome.'
    );
  }
  return outcome;
}
