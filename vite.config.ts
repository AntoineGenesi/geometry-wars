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
    watch: {
      // WSL2: Windows Node accessing files via \\wsl$ (Z: drive) causes EISDIR
      // errors on chokidar file watchers. Exclude non-essential directories and
      // use polling on Windows to avoid native watcher crashes on 9P filesystem.
      usePolling: process.platform === 'win32',
      ignored: [
        '**/v3_LAN_working/**',
        '**/.claude/worktrees/**',
        '**/.claude/worker-logs/**',
        '**/dist/**',
      ],
    },
    // COOP/COEP headers: required for SharedArrayBuffer, which Three.js WebGPU
    // backend uses internally. Without these, browser security policy disables
    // SharedArrayBuffer and Three.js WebGPU initialization fails silently.
    //
    // LAN multiplayer compatibility: These headers are safe for LAN use because
    // all game assets are served from the same Vite server (same origin). COEP
    // only requires cross-origin resources to have CORP headers — since we serve
    // everything locally, this requirement is met. Tested to work with Safari 15.2+
    // and mobile browsers on LAN.
    //
    // If LAN issues arise: the Colyseus WebSocket proxy (/ws) and all game assets
    // come from the same host:port, so they satisfy COEP's same-origin requirement.
    //
    // no-store: prevents browsers (especially laptop/phone LAN clients) from
    // serving stale cached JS modules when the dev server restarts between
    // sessions. In dev mode this has no downside — always want latest source.
    headers: {
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
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
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/*.spec.js', '**/*.spec.ts', 'node_modules/**'],
    // Use forks pool to isolate PlaygroundGame WebGL/timer state between test files.
    // Without this, RAF loops and setInterval handles from one file bleed into others.
    pool: 'forks',
    // Reduce teardown timeout: if a worker doesn't exit cleanly (e.g. EffectDictionary
    // saveTimer keeps the process alive), kill it after 5s instead of the default 10s.
    teardownTimeout: 5000,
  },
})
