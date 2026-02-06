import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'es2022',
    outDir: 'dist'
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.spec.js', '**/*.spec.ts', 'node_modules/**'],
  },
})
