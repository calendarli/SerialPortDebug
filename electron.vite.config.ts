import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@common': resolve('src/common'), '@renderer': resolve('src/renderer/src') }
export default defineConfig({
  main: { resolve: { alias }, build: { minify: 'esbuild' } },
  preload: { resolve: { alias }, build: { minify: 'esbuild' } },
  renderer: {
    worker: { format: 'es' },
    resolve: { alias },
    plugins: [react()],
    build: {
      // electron-vite disables minification by default, including the TS compiler.
      minify: 'esbuild',
      rollupOptions: {
        input: {
          main: resolve('src/renderer/index.html'),
          help: resolve('src/renderer/help/index.html'),
          programmingManual: resolve('src/renderer/programming-manual/index.html')
        }
      }
    }
  }
})
