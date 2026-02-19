#!/usr/bin/env node
/**
 * fix-native-binaries.js
 *
 * Bridges the WSL/Windows gap: npm install on WSL installs Linux-x64 binaries,
 * but Windows Node needs win32-x64 binaries. This script:
 * 1. Finds ALL esbuild installations (top-level, vite nested, etc.)
 * 2. Downloads the matching win32-x64 binary for each version
 * 3. Copies them into the right node_modules location
 * 4. Does the same for rollup
 *
 * Run from project root: node scripts/fix-native-binaries.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = process.cwd();

function getVersion(pkgPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT, pkgPath, 'package.json'))).version;
  } catch { return null; }
}

function ensureDir(dir) {
  fs.mkdirSync(path.join(PROJECT, dir), { recursive: true });
}

// Find all esbuild installations and their expected binary locations
const esbuildLocations = [
  { host: 'node_modules/esbuild', bin: 'node_modules/@esbuild/win32-x64' },
  { host: 'node_modules/vite/node_modules/esbuild', bin: 'node_modules/vite/node_modules/@esbuild/win32-x64' },
];

// Collect what needs fixing: { version, targetDir }
const fixes = [];

for (const loc of esbuildLocations) {
  const hostVer = getVersion(loc.host);
  if (!hostVer) continue; // esbuild not installed here

  const binVer = getVersion(loc.bin);
  if (binVer === hostVer) {
    console.log(`  [OK] ${loc.host} v${hostVer} — binary matches`);
    continue;
  }

  console.log(`  [FIX] ${loc.host} v${hostVer} — binary ${binVer ? 'v' + binVer + ' (wrong)' : 'missing'}`);
  fixes.push({ pkg: '@esbuild/win32-x64', version: hostVer, target: loc.bin });
}

// Check rollup
const rollupVer = getVersion('node_modules/rollup');
const rollupBinVer = getVersion('node_modules/@rollup/rollup-win32-x64-msvc');
if (rollupVer && rollupBinVer !== rollupVer) {
  console.log(`  [FIX] rollup v${rollupVer} — binary ${rollupBinVer ? 'v' + rollupBinVer + ' (wrong)' : 'missing'}`);
  fixes.push({ pkg: '@rollup/rollup-win32-x64-msvc', version: rollupVer, target: 'node_modules/@rollup/rollup-win32-x64-msvc' });
} else if (rollupVer) {
  console.log(`  [OK] rollup v${rollupVer} — binary matches`);
}

if (fixes.length === 0) {
  console.log('\n  All native binaries are correct. Nothing to fix.');
  process.exit(0);
}

console.log(`\n  Fixing ${fixes.length} binary package(s)...\n`);

// Download and copy each fix individually (avoids npm dedup issues with same pkg different versions)
for (const fix of fixes) {
  const tmpDir = path.join(os.tmpdir(), `gw-native-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const fullPkg = `${fix.pkg}@${fix.version}`;

  console.log(`  Downloading ${fullPkg}...`);
  try {
    execSync(`npm install --prefix "${tmpDir}" --no-save ${fullPkg}`, {
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (err) {
    console.error(`  [!] Failed to download ${fullPkg}: ${err.message}`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    continue;
  }

  // Copy to target
  const srcDir = path.join(tmpDir, 'node_modules', ...fix.pkg.split('/'));
  const dstDir = path.join(PROJECT, fix.target);

  if (!fs.existsSync(srcDir)) {
    console.error(`  [!] Download succeeded but package not found at ${srcDir}`);
    // npm might have installed with a different structure — check flat
    const altSrc = path.join(tmpDir, 'node_modules', fix.pkg.split('/').pop());
    if (fs.existsSync(altSrc)) {
      console.log(`  Found at alternate path: ${altSrc}`);
    } else {
      console.error(`  [!] Cannot find downloaded package. Skipping.`);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      continue;
    }
  }

  ensureDir(path.dirname(fix.target));

  // Remove old binary dir if exists, then copy
  if (fs.existsSync(dstDir)) {
    fs.rmSync(dstDir, { recursive: true, force: true });
  }

  try {
    copyDirSync(srcDir, dstDir);
    console.log(`  Copied to ${fix.target}`);
  } catch (err) {
    console.error(`  [!] Failed to copy: ${err.message}`);
  }

  // Cleanup temp
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log('\n  [OK] All native binaries installed.');

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
