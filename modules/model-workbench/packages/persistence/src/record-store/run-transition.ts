import {
  canonicalJson,
  ModelRunStatus,
  modelRunDefinitionsEqual,
  parseJsonValue,
  type ActiveModelRun,
  type TerminalModelRun,
} from '@ta-agent/workbench-domain';

export function activeRunCanComplete(
  existing: ActiveModelRun,
  terminal: TerminalModelRun
): boolean {
  if (
    !modelRunDefinitionsEqual(existing, terminal) ||
    existing.dispatchedAt !== terminal.dispatchedAt
  ) {
    return false;
  }
  if (existing.status === ModelRunStatus.Starting) {
    return terminal.execution === undefined && terminal.progress === undefined;
  }
  return (
    jsonValuesEqual(existing.execution, terminal.execution) &&
    jsonValuesEqual(existing.progress, terminal.progress)
  );
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(parseJsonValue(left)) === canonicalJson(parseJsonValue(right));
}
