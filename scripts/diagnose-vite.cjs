/**
 * Diagnose Vite file loading issues on Windows.
 * Run: node scripts\diagnose-vite.cjs
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT = process.cwd();

console.log('=== Vite Diagnostics v3 ===');
console.log('Platform:', process.platform);
console.log('Node:', process.version);
console.log('CWD:', PROJECT);

// Delete deps cache
const depsDir = path.join(PROJECT, 'node_modules', '.vite', 'deps');
if (fs.existsSync(depsDir)) {
  console.log('Deps cache found — deleting...');
  fs.rmSync(depsDir, { recursive: true, force: true });
  console.log('Deleted.');
}

console.log('\nStarting Vite...\n');

// Use pathToFileURL for correct UNC path handling
const viteEntry = pathToFileURL(path.join(PROJECT, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href;

async function testVite() {
  try {
    const vite = await import(viteEntry);

    // Test 1: Minimal config (no plugins)
    console.log('TEST 1: Vite with no plugins...');
    let server;
    try {
      server = await vite.createServer({
        root: PROJECT,
        server: { port: 3098, host: false, open: false },
        logLevel: 'silent',
        plugins: [],
        resolve: {
          alias: { '@': path.resolve(PROJECT, 'src') }
        },
      });
      await server.listen();
      console.log('  Server started on port', server.config.server.port);

      try {
        const result = await server.transformRequest('/src/main.ts');
        if (result) {
          console.log('  TRANSFORM OK —', result.code.length, 'chars');
        } else {
          console.log('  TRANSFORM returned null');
        }
      } catch (e) {
        console.log('  TRANSFORM FAILED:', e.message);
        if (e.plugin) console.log('  Plugin:', e.plugin);
        if (e.id) console.log('  File ID:', e.id);
        console.log('  Stack:', e.stack?.split('\n').slice(1, 6).join('\n'));
      }
      await server.close();
    } catch (e) {
      console.log('  SERVER START FAILED:', e.message);
      console.log('  Stack:', e.stack?.split('\n').slice(1, 4).join('\n'));
      if (server) await server.close().catch(() => {});
    }

    // Test 2: Full config (with plugins from vite.config.ts)
    console.log('\nTEST 2: Vite with full config (vite.config.ts)...');
    let server2;
    try {
      server2 = await vite.createServer({
        root: PROJECT,
        server: { port: 3097, host: false, open: false },
        logLevel: 'silent',
      });
      await server2.listen();
      console.log('  Server started on port', server2.config.server.port);

      try {
        const result = await server2.transformRequest('/src/main.ts');
        if (result) {
          console.log('  TRANSFORM OK —', result.code.length, 'chars');
        } else {
          console.log('  TRANSFORM returned null');
        }
      } catch (e) {
        console.log('  TRANSFORM FAILED:', e.message);
        if (e.plugin) console.log('  Plugin:', e.plugin);
        if (e.id) console.log('  File ID:', e.id);
        console.log('  Stack:', e.stack?.split('\n').slice(1, 6).join('\n'));
      }
      await server2.close();
    } catch (e) {
      console.log('  SERVER START FAILED:', e.message);
      console.log('  Stack:', e.stack?.split('\n').slice(1, 4).join('\n'));
      if (server2) await server2.close().catch(() => {});
    }

    // Test 3: Check path resolution
    console.log('\nTEST 3: Path resolution check...');
    const resolved = path.resolve(PROJECT, 'src', 'main.ts');
    console.log('  path.resolve:', resolved);
    console.log('  pathToFileURL:', pathToFileURL(resolved).href);
    console.log('  fs.existsSync:', fs.existsSync(resolved));

    // Check if the issue is with how Vite normalizes paths
    const normalized = resolved.replace(/\\/g, '/');
    console.log('  normalized (fwd slash):', normalized);

  } catch (e) {
    console.log('FATAL:', e.message);
    console.log('Stack:', e.stack?.split('\n').slice(1, 6).join('\n'));
  }

  process.exit(0);
}

testVite();
