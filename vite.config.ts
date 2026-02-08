import { defineConfig } from 'vite'
import path from 'path'
import lanPlugin from './vite-plugin-lan'

export default defineConfig({
  plugins: [lanPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 3000,
    host: true,
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
