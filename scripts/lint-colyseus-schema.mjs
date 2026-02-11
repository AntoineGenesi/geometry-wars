#!/usr/bin/env node
/**
 * Colyseus Schema Lint — Enforces `declare` keyword on Schema properties.
 *
 * WHY: With ES2022 target, class field initializers use Object.defineProperty
 * which overwrites Schema's getter/setter change-tracking descriptors.
 * Using `declare` emits no JS, so Schema's tracking survives.
 *
 * WHAT: Scans all .ts files in server/schema/ for classes extending Schema.
 * Flags any property that uses `!:` or plain `:` instead of `declare`.
 *
 * RUN: node scripts/lint-colyseus-schema.mjs
 * Or via npm: npm run lint:schema
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SCHEMA_DIR = join(import.meta.dirname, '..', 'server', 'schema');

// Matches class Foo extends Schema (with optional generics/whitespace)
const CLASS_RE = /class\s+(\w+)\s+extends\s+Schema\b/;

// Matches property declarations inside a class body
// Valid: `declare foo: Type;`
// Invalid: `foo: Type;` or `foo!: Type;` or `public foo: Type;`
const PROP_RE = /^\s+(public\s+|private\s+|protected\s+|readonly\s+)*(declare\s+)?(\w+)\s*(!?)\s*:\s*(.+?)\s*;/;

// Skip constructor, methods, comments, empty lines
const SKIP_RE = /^\s*(constructor|\/\/|\/\*|\*|}\s*$|$|declare\s)/;

let errors = 0;
let filesChecked = 0;

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relPath = relative(process.cwd(), filePath);

  let inSchemaClass = false;
  let braceDepth = 0;
  let className = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for Schema class start
    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      inSchemaClass = true;
      className = classMatch[1];
      braceDepth = 0;
      // Count opening braces on this line
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      continue;
    }

    if (inSchemaClass) {
      // Track brace depth
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      // Class ended
      if (braceDepth <= 0) {
        inSchemaClass = false;
        continue;
      }

      // Skip non-property lines
      if (SKIP_RE.test(line)) continue;

      // Check property declarations at depth 1 (direct class body)
      const propMatch = line.match(PROP_RE);
      if (propMatch) {
        const hasDeclare = !!propMatch[2];
        const propName = propMatch[3];
        const hasBang = propMatch[4] === '!';

        if (!hasDeclare) {
          errors++;
          const lineNum = i + 1;
          const suggestion = hasBang
            ? `Use 'declare ${propName}: ...' instead of '${propName}!: ...'`
            : `Use 'declare ${propName}: ...' instead of '${propName}: ...'`;
          console.error(
            `\x1b[31mERROR\x1b[0m ${relPath}:${lineNum} — ${className}.${propName}: Missing 'declare' keyword.`
          );
          console.error(`  ${suggestion}`);
          console.error(
            `  Schema properties MUST use 'declare' with ES2022 to preserve change tracking.\n`
          );
        }
      }
    }
  }

  filesChecked++;
}

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    console.error(`Cannot read directory: ${dir}`);
    process.exit(1);
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      scanFile(full);
    }
  }
}

// Run
scanDir(SCHEMA_DIR);

if (errors > 0) {
  console.error(`\n\x1b[31m✗ ${errors} schema property error(s) found.\x1b[0m`);
  console.error('All Schema properties must use the `declare` keyword.');
  console.error('See: https://docs.colyseus.io/state/schema/#es2022');
  process.exit(1);
} else {
  console.log(`\x1b[32m✓ ${filesChecked} schema file(s) checked — all properties use 'declare'.\x1b[0m`);
}
