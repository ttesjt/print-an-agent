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

export const boundaryConfigs = Object.freeze([
  {
    files: productionSource,
    rules: moduleRestrictions([]),
  },
  {
    files: [
      'modules/model-workbench/{apps,packages}/*/src/**/*.{ts,tsx}',
      'modules/model-workbench/templates/*/*/src/**/*.{ts,tsx}',
    ],
    rules: moduleRestrictions([
      {
        group: ['@ta-agent/agent-*', '@ta-agent/self-learn-*'],
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
]);
