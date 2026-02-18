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
    port: parseInt(process.env.VITE_PORT || '3000'),
    host: true,
    open: true,
    // COOP/COEP headers removed - they block cross-device LAN access
    // (Safari and mobile browsers refuse to load resources with these headers)
    // SharedArrayBuffer is not used, so these are unnecessary
  },
  build: {
    target: 'es2022',
    outDir: 'dist'
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['**/*.spec.js', '**/*.spec.ts', 'node_modules/**'],
    // Prevent process from hanging after tests complete due to open handles
    // (timers from EffectDictionary, GameAnalytics, etc.)
    pool: 'forks',
  },
})
