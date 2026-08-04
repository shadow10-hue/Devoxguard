// @ts-check
// Single ESLint flat config for the whole monorepo (engine, api-demo,
// dashboard, scripts). Strictness is tiered: api-demo keeps the
// type-checked + prettier setup it already passed; engine/dashboard start on
// the recommended baseline and can be ratcheted up later.
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.d.ts',
      'eslint.config.mjs',
      '.claude/**',
    ],
  },

  // ---- Baseline for all TypeScript in the repo ----
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---- api-demo src: preserves its original stricter type-checked config.
  // test/ and scripts/ sit outside the tsconfig graph the project service
  // resolves, so they stay on the non-type-aware baseline above. ----
  {
    files: ['packages/api-demo/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  {
    files: ['packages/api-demo/**/*.ts'],
    extends: [eslintPluginPrettierRecommended],
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },

  // ---- dashboard: Vue SFCs (error-prevention tier) + browser globals ----
  ...pluginVue.configs['flat/essential'].map((config) => ({
    ...config,
    files: ['packages/dashboard/**/*.vue'],
  })),
  {
    files: ['packages/dashboard/**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // Single-word names (Badge, …) are established in this codebase.
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['packages/dashboard/**/*.ts', 'packages/dashboard/**/*.mts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
);
