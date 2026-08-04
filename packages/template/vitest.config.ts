import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Unit tests: colocated next to source files
      include: ['src/**/*.test.ts'],
      // Integration/e2e tests, fixtures, and setup live in test/
      setupFiles: ['test/setup.ts'],
      projects: [
        {
          test: {
            name: 'unit',
            include: ['src/**/*.test.ts'],
          },
        },
        {
          test: {
            name: 'integration',
            include: ['test/**/*.test.ts'],
            setupFiles: ['test/setup.ts'],
          },
        },
      ],
    },
  })
);
