import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { boundaryConfigs } from './eslint.boundaries.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.venv/**',
      '**/*.tsbuildinfo',
      '**/coverage/**',
      'data/**',
      'artifacts/**',
      'state/**',
      'temp/**',
      'eslint.config.js',
      'eslint.boundaries.js',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...boundaryConfigs
);
