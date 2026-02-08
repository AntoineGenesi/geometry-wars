import { defineConfig } from 'vite'
import path from 'path'
import lanPlugin from './vite-plugin-lan'
import { compression } from 'vite-plugin-compression2'
import zlib from 'zlib'

export default defineConfig({
  plugins: [
    lanPlugin(),
    compression({
      algorithm: 'brotliCompress',
      exclude: [/\.(br)$/, /\.(gz)$/],
      compressionOptions: {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 3000,
    host: true,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
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
