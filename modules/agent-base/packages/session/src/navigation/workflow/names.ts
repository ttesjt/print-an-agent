export const SESSION_NAVIGATION_WORKFLOW_NAME = 'navigateSession' as const;

export const SESSION_NAVIGATION_STEP_NAMES = Object.freeze([
  'runSessionNavigation',
  'validateSessionNavigation',
  'inspectSessionNavigation',
  'commitSessionNavigation',
] as const);

export type SessionNavigationWorkflowName = typeof SESSION_NAVIGATION_WORKFLOW_NAME;
export type SessionNavigationStepName = (typeof SESSION_NAVIGATION_STEP_NAMES)[number];
export type SessionNavigationLeafStepName = Exclude<
  SessionNavigationStepName,
  'runSessionNavigation'
>;
