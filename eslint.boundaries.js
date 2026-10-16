const productionSource = [
  'modules/*/{apps,packages}/*/src/**/*.{ts,tsx}',
  'modules/*/templates/*/*/src/**/*.{ts,tsx}',
];

const publicImportRestrictions = [
  {
    group: ['@ta-agent/*/src', '@ta-agent/*/src/**'],
    message: 'Import only public @ta-agent package exports.',
  },
];

function moduleRestrictions(forbiddenGroups) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          ...publicImportRestrictions,
          ...forbiddenGroups.map(({ group, message }) => ({ group, message })),
        ],
      },
    ],
  };
}

const workflowDomainRestrictions = [
  {
    group: [
      '@ta-agent/base-*',
      '@ta-agent/workbench-*',
      '@ta-agent/self-learn-*',
      '@ta-agent/ui-*',
    ],
    message: 'Workflow must remain independent of Agent and product domains.',
  },
];

export const boundaryConfigs = Object.freeze([
  {
    files: productionSource,
    rules: moduleRestrictions([]),
  },
  {
    files: ['modules/workflow/**/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions(workflowDomainRestrictions),
  },
  {
    files: ['modules/workflow/packages/core/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      ...workflowDomainRestrictions,
      {
        group: ['@ta-agent/workflow-bundle', '@ta-agent/workflow-bundle/**'],
        message: 'Workflow Core must not depend on Bundle assembly.',
      },
    ]),
  },
  {
    files: [
      'modules/model-workbench/{apps,packages}/*/src/**/*.{ts,tsx}',
      'modules/model-workbench/templates/*/*/src/**/*.{ts,tsx}',
    ],
    rules: moduleRestrictions([
      {
        group: ['@ta-agent/base-*', '@ta-agent/self-learn-*'],
        message: 'Model Workbench must remain independent of Agent Base and Self-Learn Agent.',
      },
    ]),
  },
  {
    files: [
      'modules/agent-base/{apps,packages}/*/src/**/*.{ts,tsx}',
      'modules/agent-base/templates/*/*/src/**/*.{ts,tsx}',
    ],
    rules: moduleRestrictions([
      {
        group: ['@ta-agent/workbench-*', '@ta-agent/self-learn-*'],
        message: 'Agent Base must remain independent of Model Workbench and Self-Learn Agent.',
      },
    ]),
  },
  {
    files: ['modules/agent-ui/packages/*/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      {
        group: ['@ta-agent/base-*', '@ta-agent/workbench-*', '@ta-agent/self-learn-*'],
        message: 'Reusable Agent UI packages must depend only on UI-owned contracts.',
      },
    ]),
  },
  {
    files: ['modules/agent-ui/apps/*/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      {
        group: ['@ta-agent/workbench-*', '@ta-agent/self-learn-*'],
        message: 'Generic Agent UI applications must not depend on product-specific modules.',
      },
    ]),
  },
]);
