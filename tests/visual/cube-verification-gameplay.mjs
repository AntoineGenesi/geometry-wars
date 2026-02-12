#!/usr/bin/env node
/**
 * Cube Geometry Visual Verification - Gameplay Focus
 *
 * Takes frequent screenshots immediately after spawn to capture actual cube gameplay
 * before player potentially dies.
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3012';
const SEED = 88888; // Different seed
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = new Date();
const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const SESSION_NAME = `${ts}_cube-gameplay`;
const SCREENSHOT_DIR = resolve(__dirname, '../..', 'test-screenshots', 'sessions', SESSION_NAME);
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

function formatUV(uv) {
  if (!uv) return 'N/A';
  return `(${uv.u?.toFixed(4) || '?'}, ${uv.v?.toFixed(4) || '?'})`;
}

async function runTest() {
  console.log('\n=== Cube Gameplay Visual Verification ===\n');
  console.log(`Session: ${SESSION_NAME}`);
  console.log(`URL: ${BASE_URL}`);
  console.log(`Seed: ${SEED}\n`);

  const observations = [];
  let screenshotNum = 1;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    console.log('Loading game...');
    const url = `${BASE_URL}?quickStart=true&surface=cube&seed=${SEED}&debug=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for countdown (3...2...1...)
    console.log('Waiting for countdown...');
    await sleep(4000);

    // Take screenshot immediately after countdown
    console.log('Capturing initial gameplay...');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${String(screenshotNum++).padStart(2, '0')}-gameplay-start.png`) });

    let player = await page.evaluate(() => {
      return window.__gameDebug ? window.__gameDebug.getPlayerState() : null;
    });

    if (player) {
      observations.push({
        test: 'Initial Spawn',
        position: formatUV(player.surfaceUV),
        timestamp: '0s',
      });
      console.log(`  Position: ${formatUV(player.surfaceUV)}`);
    }

    // Take rapid screenshots during first 10 seconds
    console.log('Capturing movement sequence...');
    for (let i = 0; i < 10; i++) {
      // Move in a pattern: forward, right, back, left
      const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
      const key = keys[i % 4];

      await page.keyboard.down(key);
      await sleep(800);
      await page.keyboard.up(key);

      // Screenshot every move
      await page.screenshot({
        path: resolve(SCREENSHOT_DIR, `${String(screenshotNum++).padStart(2, '0')}-move-${i+1}.png`)
      });

      player = await page.evaluate(() => {
        return window.__gameDebug ? window.__gameDebug.getPlayerState() : null;
      });

      if (player) {
        observations.push({
          test: `Move ${i+1}`,
          position: formatUV(player.surfaceUV),
          timestamp: `${(i+1)*0.8}s`,
        });
        console.log(`  Move ${i+1}: ${formatUV(player.surfaceUV)}`);
      }

      await sleep(200);
    }

    // Check camera state
    const camera = await page.evaluate(() => {
      return window.__gameDebug ? window.__gameDebug.getCameraState() : null;
    });

    if (camera) {
      observations.push({
        test: 'Camera State',
        position: `Pos: (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)})`,
        timestamp: 'Final',
      });
      console.log(`  Camera: (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)})`);
    }

    // Take final screenshot
    await page.screenshot({
      path: resolve(SCREENSHOT_DIR, `${String(screenshotNum++).padStart(2, '0')}-final.png`)
    });

    console.log(`\n${observations.length} observations recorded`);
    console.log(`${screenshotNum - 1} screenshots captured`);

    // Generate RESULTS.md
    let results = '# Cube Gameplay Visual Verification\n\n';
    results += `**Goal:** Capture actual cube surface gameplay to visually confirm geometry behavior.\n\n`;
    results += `**Surface:** cube\n`;
    results += `**Seed:** ${SEED}\n`;
    results += `**Session:** ${SESSION_NAME}\n\n`;
    results += '---\n\n';
    results += '## Observations\n\n';

    for (const obs of observations) {
      results += `### ${obs.test} (${obs.timestamp})\n`;
      results += `- **Position:** ${obs.position}\n\n`;
    }

    results += '---\n\n';
    results += '## Visual Analysis\n\n';
    results += `Captured ${screenshotNum - 1} screenshots during the first ~10 seconds of gameplay.\n\n`;
    results += 'These screenshots should show:\n';
    results += '- Cube surface appearance from multiple angles\n';
    results += '- Player movement across different regions\n';
    results += '- Camera orientation relative to surface\n';
    results += '- Absence of visual folds or distortions\n';
    results += '- Surface continuity during traversal\n\n';
    results += 'Review screenshots for:\n';
    results += '- ✓ Surface looks like flat panels (not curved/folded)\n';
    results += '- ✓ Player stays upright on surface\n';
    results += '- ✓ Camera follows player smoothly\n';
    results += '- ✓ No visual glitches at seam boundaries\n';
    results += '- ✓ Corners/edges look correct\n\n';
    results += `**Console Errors:** ${consoleErrors.length}\n`;

    if (consoleErrors.length > 0) {
      results += '\n**Errors:**\n';
      consoleErrors.slice(0, 5).forEach(err => {
        results += `- ${err}\n`;
      });
    }

    results += '\n---\n\n';
    results += '## Screenshots\n\n';
    results += `All files in: \`${SCREENSHOT_DIR}\`\n\n`;
    results += '- `01-gameplay-start.png` — Immediately after countdown\n';
    results += '- `02-11-move-*.png` — Sequential movement frames (W→D→S→A pattern)\n';
    results += '- `12-final.png` — Final state\n\n';
    results += 'These are the actual cube surface gameplay frames needed for Level 5 visual verification.\n';

    const resultsPath = resolve(SCREENSHOT_DIR, 'RESULTS.md');
    writeFileSync(resultsPath, results, 'utf8');

    console.log(`\nResults: ${resultsPath}`);
    console.log(`Screenshots: ${SCREENSHOT_DIR}\n`);

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
