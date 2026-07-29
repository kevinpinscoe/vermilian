// ESLint flat config. Replaces .eslintrc.json, which ESLint 10 no longer reads
// at all — eslintrc support was removed, not merely deprecated.
//
// This file is .mjs because app/package.json has no "type": "module"; a plain
// eslint.config.js would be parsed as CommonJS and these imports would fail.
//
// NOTE ON eslint-plugin-import: it used to be configured here and has been
// removed. Its latest release (2.32.0, June 2025) declares an ESLint peer range
// ending at 9, so it was formally unsupported against ESLint 10. Of the seven
// rules it actually had enabled, four — import/default, import/export,
// import/namespace, import/no-unresolved — are module-correctness checks the
// TypeScript compiler performs natively and more accurately. Those are now
// covered by `pnpm typecheck` (tsc --noEmit), which runs in CI. The other three
// (no-duplicates, no-named-as-default, no-named-as-default-member) were
// warning-level style heuristics; losing them is the deliberate price of not
// carrying an unsupported plugin. See CLAUDE.md.

import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

// typescript-eslint ships flat/recommended as an array of config objects
// (base + rules + extension-rule fixups). Flatten their rules into one bag.
const tsRecommendedRules = Object.assign(
  {},
  ...tsPlugin.configs['flat/recommended'].map((c) => c.rules ?? {}),
);

export default [
  {
    // Flat config has no .eslintignore; ignores live here. node_modules and
    // .git are ignored by default, the rest are build output.
    ignores: [
      '.vite/**',
      'out/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  {
    // This project has no linted JavaScript — sources, tests, and the build
    // configs are all TypeScript. Naming the extensions here is also what
    // makes ESLint pick them up at all: flat config lints only *.js unless a
    // config says otherwise. (The old `--ext .ts,.tsx` flag was removed in
    // ESLint 9 and does not exist in 10.)
    files: ['**/*.ts', '**/*.tsx'],

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Replaces `env: { browser, es6, node }`. es6 is now ecmaVersion above.
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },

    rules: {
      // eslint:recommended
      ...js.configs.recommended.rules,
      // plugin:@typescript-eslint/eslint-recommended — turns off core rules
      // that the TypeScript compiler already covers. Must come after the core
      // recommended set above.
      ...tsPlugin.configs['flat/eslint-recommended'].rules,
      // plugin:@typescript-eslint/recommended
      ...tsRecommendedRules,

      // The two classic hook rules. Deliberately NOT the react-hooks
      // `recommended` preset — v7 of the plugin folded in the React Compiler
      // rule set (set-state-in-effect, static-components, use-memo), which
      // errors on 14 existing call sites and would mean refactoring the board
      // components. Those rules are worth adopting, but as their own change.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // typescript-eslint v8 promoted no-unused-vars to an error in
      // `recommended` and ships no default ignore pattern. This codebase
      // already marks deliberately-unused bindings with a leading underscore —
      // interface-imposed parameters in the e2e fakes (`_url`, `_token`),
      // caught errors that are swallowed on purpose (`_e`), and reserved
      // options (`_includeResolved`). Honour that existing convention rather
      // than deleting meaningful names.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
