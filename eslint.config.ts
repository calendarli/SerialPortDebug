import { defineConfig } from 'eslint/config'
import type { Linter } from 'eslint'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'driver/**',
      'resources/**',
      'build/**',
      '**/.idea/**'
    ]
  },
  tseslint.configs.recommended as Linter.Config[],
  { ...eslintPluginReact.configs.flat.recommended, files: ['src/renderer/**/*.tsx'] },
  { ...eslintPluginReact.configs.flat['jsx-runtime'], files: ['src/renderer/**/*.tsx'] },
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': { rules: eslintPluginReactHooks.rules },
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      // React Compiler is not enabled; enforce the runtime Hooks contract.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  eslintConfigPrettier as Linter.Config
)
