import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@common': resolve('src/common'), '@renderer': resolve('src/renderer/src') }
export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    worker: { format: 'es' },
    resolve: { alias },
    plugins: [react()],
    build: {
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
