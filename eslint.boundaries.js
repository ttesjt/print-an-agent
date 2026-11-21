const productionSource = [
  'modules/*/{apps,packages}/*/src/**/*.{ts,tsx}',
  'modules/*/templates/*/*/src/**/*.{ts,tsx}',
];

const agentBaseImportPatterns = [
  '@print-an-agent/base-*',
  '@print-an-agent/agent-actor',
  '@print-an-agent/agent-actor/**',
];

const publicImportRestrictions = [
  {
    group: ['@print-an-agent/*/src', '@print-an-agent/*/src/**'],
    message: 'Import only public @print-an-agent package exports.',
  },
];

function moduleRestrictions(forbiddenGroups) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [...publicImportRestrictions, ...forbiddenGroups],
      },
    ],
  };
}

const workflowDomainRestrictions = [
  {
    group: [
      ...agentBaseImportPatterns,
      '@print-an-agent/model-invocation-*',
      '@print-an-agent/workbench-*',
      '@print-an-agent/self-learn-*',
      '@print-an-agent/ui-*',
      '@print-an-agent/context-memory*',
      '@print-an-agent/retrieval-memory*',
    ],
    message: 'Workflow must remain independent of Agent and product domains.',
  },
];

const workflowCoreRestrictions = [
  ...workflowDomainRestrictions,
  {
    group: ['@print-an-agent/workflow-core', '@print-an-agent/workflow-core/**'],
    message:
      'Workflow source consumes relative feature entries, not its own package aggregate or subpaths.',
  },
];

const modelInvocationDomainRestrictions = [
  {
    group: [
      ...agentBaseImportPatterns,
      '@print-an-agent/workbench-*',
      '@print-an-agent/self-learn-*',
      '@print-an-agent/ui-*',
      '@print-an-agent/workflow-*',
      '@print-an-agent/context-memory*',
      '@print-an-agent/retrieval-memory*',
    ],
    message: 'Model invocation must remain independent of Agent, Workflow and product domains.',
  },
];

const memoryDomainRestrictions = [
  {
    group: [
      ...agentBaseImportPatterns,
      '@print-an-agent/self-learn-*',
      '@print-an-agent/workbench-*',
      '@print-an-agent/ui-*',
      '@print-an-agent/model-invocation-pi',
      '@print-an-agent/model-invocation-token-counters',
      '@print-an-agent/model-invocation-embedding-http',
      '@earendil-works/pi-*',
    ],
    message: 'Memory capabilities must remain independent of Agent/product domains and providers.',
  },
];

const registryQualificationRestrictions = [
  {
    regex:
      '^@print-an-agent/(?:base-(?!composition/resource-registry$)|agent-actor(?:/|$)|self-learn-|workbench-|ui-|model-invocation-pi(?:/|$))|^@earendil-works/pi-',
    message: 'Registry examples consume the public Composition subpath, not Agent/product APIs.',
  },
];

const agentBaseProductRestrictions = [
  {
    group: ['@print-an-agent/workbench-*', '@print-an-agent/self-learn-*'],
    message: 'Agent Base must remain independent of Model Workbench and Self-Learn Agent.',
  },
];

export const boundaryConfigs = Object.freeze([
  { files: productionSource, rules: moduleRestrictions([]) },
  {
    files: ['modules/agent-base/tests/integration/test/resource-registry/**/*.ts'],
    rules: moduleRestrictions(registryQualificationRestrictions),
  },
  {
    // Responsibility-based example: neutral implementation and generic entry stay independent,
    // while profile.ts is an assembly/resource-resolution Service and may import Registry.
    files: [
      'modules/agent-base/tests/integration/test/resource-registry/examples/service-provisioning/{service,workflow}.ts',
    ],
    rules: moduleRestrictions([
      ...registryQualificationRestrictions,
      {
        group: ['@print-an-agent/base-composition/resource-registry', '**/resource-registry/**'],
        message:
          'Generic Services use Definition provisioning; Workflows use explicit resources. Profile resource-resolution Services may use Registry.',
      },
    ]),
  },

  {
    files: ['modules/agent-memory/tests/{qualification,retrieval-memory-qualification}/**/*.ts'],
    rules: moduleRestrictions([
      {
        group: [
          ...agentBaseImportPatterns,
          '@print-an-agent/self-learn-*',
          '@print-an-agent/workbench-*',
          '@print-an-agent/ui-*',
          '@print-an-agent/model-invocation-pi',
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
          '@print-an-agent/context-memory-sqlite',
          '@print-an-agent/retrieval-memory*',
        ],
        message:
          'Context Memory domain must not depend on storage or sibling capability implementations.',
      },
    ]),
  },
  {
    files: ['modules/agent-memory/packages/retrieval-memory/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      ...memoryDomainRestrictions,
      {
        group: [
          'node:sqlite',
          'sqlite-vec',
          '@print-an-agent/retrieval-memory-sqlite',
          '@print-an-agent/context-memory*',
        ],
        message:
          'Retrieval Memory domain cannot depend on a concrete store or sibling memory capability.',
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
          '@print-an-agent/model-invocation-pi',
          '@print-an-agent/model-invocation-pi/**',
          '@print-an-agent/model-invocation-token-counters',
          '@print-an-agent/model-invocation-token-counters/**',
          '@print-an-agent/model-invocation-embedding-http',
          '@print-an-agent/model-invocation-embedding-http/**',
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
    rules: moduleRestrictions(workflowCoreRestrictions),
  },
  {
    files: ['modules/workflow/packages/core/src/**/*.{ts,tsx}'],
    ignores: ['modules/workflow/packages/core/src/bundle/**'],
    rules: moduleRestrictions([
      ...workflowCoreRestrictions,
      {
        regex: '^(?:\\.{1,2}/)+bundle(?:/|$)',
        message: 'Workflow execution must remain independent of Bundle assembly.',
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
        group: [...agentBaseImportPatterns, '@print-an-agent/self-learn-*'],
        message: 'Model Workbench must remain independent of Agent Base and Self-Learn Agent.',
      },
    ]),
  },
  {
    files: [
      'modules/agent-base/{apps,packages}/*/src/**/*.{ts,tsx}',
      'modules/agent-base/templates/*/*/src/**/*.{ts,tsx}',
    ],
    rules: moduleRestrictions([...agentBaseProductRestrictions]),
  },
  {
    files: ['modules/agent-ui/packages/*/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      {
        group: [
          ...agentBaseImportPatterns,
          '@print-an-agent/model-invocation-*',
          '@print-an-agent/workbench-*',
          '@print-an-agent/self-learn-*',
        ],
        message: 'Reusable Agent UI packages must depend only on UI-owned contracts.',
      },
    ]),
  },
  {
    files: ['modules/agent-ui/apps/*/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      {
        group: ['@print-an-agent/workbench-*', '@print-an-agent/self-learn-*'],
        message: 'Generic Agent UI applications must not depend on product-specific modules.',
      },
    ]),
  },
  {
    files: [
      'modules/agent-base/packages/{runtime,request,session,agent-actor,identity-config,tool}/src/**/*.ts',
    ],
    rules: moduleRestrictions([
      {
        group: [
          '@print-an-agent/base-composition/resource-registry',
          '@print-an-agent/base-composition/resource-registry/**',
        ],
        message: 'Execution and authority domains must remain independent of composition Registry.',
      },
      ...agentBaseProductRestrictions,
    ]),
  },
  {
    files: [
      'modules/agent-base/packages/composition/src/{management,runtime,sessionless}/**/*.ts',
      'modules/agent-base/packages/composition/src/index.ts',
      'modules/agent-base/packages/standalone-agent/src/{runtime,provider,bootstrap,setup,service-projections,workflows,steps}/**/*.ts',
    ],
    rules: moduleRestrictions([
      {
        group: ['@print-an-agent/base-composition/resource-registry', '**/resource-registry/**'],
        message:
          'Generic application Services use Definition factories/resolvers; concrete Profile resource-resolution Services may use Registry.',
      },
      ...agentBaseProductRestrictions,
    ]),
  },
  {
    // Keep this after the module-wide Base rule so relocation cannot add domain dependencies.
    files: ['modules/agent-base/packages/composition/src/resource-registry/**/*.ts'],
    rules: moduleRestrictions([
      {
        group: ['@print-an-agent/*'],
        message: 'Composition Registry internals remain domain independent.',
      },
    ]),
  },
  {
    files: ['modules/agent-base/packages/{request,session}/src/**/*.{ts,tsx}'],
    rules: moduleRestrictions([
      ...agentBaseProductRestrictions,
      {
        group: [
          '@print-an-agent/base-runtime',
          '@print-an-agent/base-runtime/**',
          '@print-an-agent/base-composition',
          '@print-an-agent/base-composition/**',
        ],
        message:
          'Request and Session workflows consume explicit inputs and resources; Agent binding belongs to composition.',
      },
    ]),
  },
  {
    files: ['modules/agent-base/packages/identity-config/src/**/*.ts'],
    rules: moduleRestrictions([
      {
        group: [
          '@print-an-agent/*',
          '@print-an-agent/*/**',
          'node:fs',
          'node:fs/**',
          'node:sqlite',
          'better-sqlite3',
          'sqlite-vec',
        ],
        message:
          'Identity/Config uses relative feature contracts and injected ports, independent of concrete integrations.',
      },
    ]),
  },
]);
