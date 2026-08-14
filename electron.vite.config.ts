import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    worker: {
      format: 'es'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        'monaco-editor/esm/vs/editor/editor.api.js': resolve(
          'node_modules/monaco-editor/esm/vs/editor/editor.api.js'
        ),
        'monaco-editor/esm/vs/language/typescript/monaco.contribution.js': resolve(
          'node_modules/monaco-editor/esm/vs/language/typescript/monaco.contribution.js'
        ),
        'monaco-editor/esm/vs/languages/definitions/typescript/typescript.js': resolve(
          'node_modules/monaco-editor/esm/vs/languages/definitions/typescript/typescript.js'
        )
      }
    },
    plugins: [react()]
  }
})
