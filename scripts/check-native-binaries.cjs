// Checks if all native binaries match their host packages.
// Exit 0 = all good, Exit 1 = needs fixing.
var fs = require('fs');
var path = require('path');

function ver(p) {
  try { return JSON.parse(fs.readFileSync(path.join(p, 'package.json'))).version; }
  catch(e) { return null; }
}

var ok = true;

// Check esbuild — top level
var ev = ver('node_modules/esbuild');
var ebv = ver('node_modules/@esbuild/win32-x64');
if (ev && ev !== ebv) ok = false;

// Check esbuild — vite nested
var vev = ver('node_modules/vite/node_modules/esbuild');
var vebv = ver('node_modules/vite/node_modules/@esbuild/win32-x64');
if (vev && vev !== vebv) ok = false;

// Check rollup
var rv = ver('node_modules/rollup');
var rbv = ver('node_modules/@rollup/rollup-win32-x64-msvc');
if (rv && rv !== rbv) ok = false;

process.exit(ok ? 0 : 1);
