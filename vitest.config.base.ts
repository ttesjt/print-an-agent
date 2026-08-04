import { defineConfig } from 'vitest/config';

/**
 * Shared vitest configuration for all packages.
 * Individual packages can extend this and override as needed.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
