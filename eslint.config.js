import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

// .ts/.tsx files are type-checked and linted by `next build`, which runs the
// TypeScript compiler over the whole project. This config covers the .js/.jsx
// sources, which nothing else checks.
export default defineConfig([
  globalIgnores(['.next', 'node_modules', 'next-env.d.ts']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      // Browser globals for components, Node globals for API route handlers
      // and config files.
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // `const { meeting_day, ...rest } = payload` is how this codebase drops a key before
      // a write. The named binding is the point of the line and is meant to go unread, so
      // reporting it trains people to ignore this rule rather than to read it.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
])
