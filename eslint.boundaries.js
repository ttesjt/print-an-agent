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
      '@ta-agent/model-invocation-*',
      '@ta-agent/workbench-*',
      '@ta-agent/self-learn-*',
      '@ta-agent/ui-*',
      '@ta-agent/context-memory*',
      '@ta-agent/retrieval-memory*',
    ],
    message: 'Workflow must remain independent of Agent and product domains.',
  },
];

const modelInvocationDomainRestrictions = [
  {
    group: [
      '@ta-agent/base-*',
      '@ta-agent/workbench-*',
      '@ta-agent/self-learn-*',
      '@ta-agent/ui-*',
      '@ta-agent/workflow-*',
      '@ta-agent/context-memory*',
      '@ta-agent/retrieval-memory*',
    ],
    message: 'Model invocation must remain independent of Agent, Workflow and product domains.',
  },
];

const memoryDomainRestrictions = [
  {
    group: [
      '@ta-agent/base-*',
      '@ta-agent/self-learn-*',
      '@ta-agent/workbench-*',
      '@ta-agent/ui-*',
      '@ta-agent/model-invocation-pi',
      '@ta-agent/model-invocation-token-counters',
      '@earendil-works/pi-*',
    ],
    message: 'Memory capabilities must remain independent of Agent/product domains and providers.',
  },
];

export const boundaryConfigs = Object.freeze([
  { files: productionSource, rules: moduleRestrictions([]) },
  {
    files: ['modules/agent-memory/tests/qualification/**/*.ts'],
    rules: moduleRestrictions([
      {
        group: [
          '@ta-agent/base-*',
          '@ta-agent/self-learn-*',
          '@ta-agent/workbench-*',
          '@ta-agent/ui-*',
          '@ta-agent/model-invocation-pi',
          '@earendil-works/pi-*',
        ],
        message: 'Memory qualification must be an independent public-package consumer.',
      },
    ]),
  },
  {
    files: ['modules/agent-memory/**/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions(memoryDomainRestrictions),
  },
  {
    files: ['modules/agent-memory/packages/context-memory/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      ...memoryDomainRestrictions,
      {
        group: [
          'node:sqlite',
          'better-sqlite3',
          '@ta-agent/context-memory-sqlite',
          '@ta-agent/retrieval-memory*',
        ],
        message:
          'Context Memory domain must not depend on storage or sibling capability implementations.',
      },
    ]),
  },
  {
    files: ['modules/model-invocation/**/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions(modelInvocationDomainRestrictions),
  },
  {
    files: ['modules/model-invocation/packages/core/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      ...modelInvocationDomainRestrictions,
      {
        group: [
          '@ta-agent/model-invocation-pi',
          '@ta-agent/model-invocation-pi/**',
          '@ta-agent/model-invocation-token-counters',
          '@ta-agent/model-invocation-token-counters/**',
          '@earendil-works/pi-*',
          'typebox',
        ],
        message: 'Invocation Core must not depend on its provider adapter or SDK.',
      },
    ]),
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
        group: [
          '@ta-agent/base-*',
          '@ta-agent/model-invocation-*',
          '@ta-agent/workbench-*',
          '@ta-agent/self-learn-*',
        ],
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
