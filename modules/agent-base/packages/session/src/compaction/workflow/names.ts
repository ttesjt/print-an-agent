export const SESSION_COMPACTION_WORKFLOW_NAME = 'compactSession' as const;

export const SESSION_COMPACTION_STEP_NAMES = Object.freeze([
  'runSessionCompaction',
  'inspectSession',
  'selectCompactionSource',
  'buildCompactedContext',
  'persistCompaction',
] as const);

export type SessionCompactionWorkflowName = typeof SESSION_COMPACTION_WORKFLOW_NAME;
export type SessionCompactionStepName = (typeof SESSION_COMPACTION_STEP_NAMES)[number];
export type SessionCompactionLeafStepName = Exclude<
  SessionCompactionStepName,
  'runSessionCompaction'
>;
