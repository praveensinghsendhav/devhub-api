import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

// `typescript-eslint` hard-refuses to run on TypeScript 7 (native compiler) as of this writing
// (https://github.com/typescript-eslint/typescript-eslint/issues/10940), and espree (ESLint's
// default parser) can't parse TS syntax at all — so this only lints plain JS/config files for
// now. `npm run typecheck` (tsc, which does support TS7) is the authoritative correctness check
// until typescript-eslint ships TS7 support; re-add it here once it does.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/*.ts',
      '**/*.tsx',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  eslintConfigPrettier,
];
