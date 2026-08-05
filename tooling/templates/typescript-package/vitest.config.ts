import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
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
          },
        },
      ],
    },
  })
);
