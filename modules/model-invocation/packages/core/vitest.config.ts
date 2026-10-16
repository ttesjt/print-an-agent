import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/{unit,integration}/**/*.test.ts'],
      projects: [
        { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
        { test: { name: 'integration', include: ['test/integration/**/*.test.ts'] } },
      ],
    },
  })
);
