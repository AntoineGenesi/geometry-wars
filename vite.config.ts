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
    open: false,
    // COOP/COEP headers removed - they block cross-device LAN access
    // (Safari and mobile browsers refuse to load resources with these headers)
    // SharedArrayBuffer is not used, so these are unnecessary
    proxy: {
      // Route Colyseus WebSocket (and matchmake HTTP) through the Vite dev server.
      // LAN clients connect to ws://host:3000/ws (same port as the web page),
      // and Vite proxies it to localhost:2567 (Colyseus) from inside WSL2 / Windows.
      // This eliminates the need for a separate portproxy rule for port 2567 —
      // only port 3000 needs to be accessible from the LAN.
      '/ws': {
        target: 'http://localhost:2567',
        ws: true,
        rewrite: (path: string) => path.replace(/^\/ws/, '') || '/',
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist'
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['**/*.spec.js', '**/*.spec.ts', 'node_modules/**'],
    // Use forks pool to isolate PlaygroundGame WebGL/timer state between test files.
    // Without this, RAF loops and setInterval handles from one file bleed into others.
    pool: 'forks',
    // Reduce teardown timeout: if a worker doesn't exit cleanly (e.g. EffectDictionary
    // saveTimer keeps the process alive), kill it after 5s instead of the default 10s.
    teardownTimeout: 5000,
  },
})
