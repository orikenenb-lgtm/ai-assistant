import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'resources/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // ה-renderer: אסור לייבא מודולים של Node/Electron — הכול עובר דרך window.jarvis
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['electron', 'node:*', 'fs', 'child_process', 'path', 'os', '../main/*', '../../main/*', '**/main/**'], message: 'ה-renderer לא ניגש ל-Node/Electron/main ישירות. השתמש ב-window.jarvis.' },
        ],
      }],
    },
  },
  {
    // בתהליך main: אסור shell:true ואסור exec (שרשור פקודות). spawn בלבד עם מערך ארגומנטים.
    files: ['src/main/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "Property[key.name='shell'][value.value=true]", message: 'אסור shell:true. השתמש ב-spawn עם מערך ארגומנטים.' },
        { selector: "CallExpression[callee.property.name=/^(exec|execSync)$/]", message: 'אסור exec/execSync — סכנת הזרקת פקודות.' },
        { selector: "CallExpression[callee.name=/^(exec|execSync)$/]", message: 'אסור exec/execSync — סכנת הזרקת פקודות.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
