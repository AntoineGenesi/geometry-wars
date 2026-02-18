#!/usr/bin/env node
/**
 * S24 Splitscreen Rendering Diagnosis
 *
 * Captures what the splitscreen looks like — diagnose before applying fix.
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/sessions/s24-splitscreen-render-fix');
const BASE_URL = 'http://localhost:3017';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  S24 Splitscreen Rendering Diagnosis');
  console.log('='.repeat(70));

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  const consoleLogs = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    consoleLogs.push(msg.text());
    const txt = msg.text();
    if (txt.includes('[Local') || txt.includes('[Main]') || txt.includes('[SplitScreen]') || txt.includes('ERROR')) {
      console.log('  [Browser]', txt);
    }
  });

  try {
    // Navigate using domcontentloaded — game's RAF loop prevents networkidle2
    const url = `${BASE_URL}/?mode=multiplayer&surface=sphere&players=2&testMode=true`;
    console.log(`\nNavigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for game to fully initialize — SwiftShader is slow (~7 FPS)
    // Need to get past loading screen and let game render a few frames
    console.log('Waiting 18 seconds for game to fully initialize...');
    await sleep(18000);

    // Take before-fix screenshot
    const path1 = resolve(SCREENSHOT_DIR, '01-current-state.png');
    await page.screenshot({ path: path1 });
    console.log(`\nScreenshot saved: ${path1}`);

    // Pixel analysis: read from the WebGL canvas
    const pixelData = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'no canvas' };

      // Try to read WebGL pixels directly
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

      const w = canvas.width;
      const h = canvas.height;

      // Key sample points for 2-player horizontal split
      const points = [
        // Left half (Player 1's viewport: x=0..640)
        { name: 'P1-left',   x: Math.floor(w * 0.10), y: Math.floor(h * 0.5) },
        { name: 'P1-center', x: Math.floor(w * 0.25), y: Math.floor(h * 0.5) },
        { name: 'P1-edge',   x: Math.floor(w * 0.49), y: Math.floor(h * 0.5) },
        // Divider line
        { name: 'divider',   x: Math.floor(w * 0.50), y: Math.floor(h * 0.5) },
        // Right half (Player 2's viewport: x=640..1280)
        { name: 'P2-edge',   x: Math.floor(w * 0.51), y: Math.floor(h * 0.5) },
        { name: 'P2-center', x: Math.floor(w * 0.75), y: Math.floor(h * 0.5) },
        { name: 'P2-right',  x: Math.floor(w * 0.90), y: Math.floor(h * 0.5) },
      ];

      const results = [];
      if (gl) {
        for (const { name, x, y } of points) {
          const pixel = new Uint8Array(4);
          // WebGL y=0 is at the bottom, DOM y=0 is at the top
          const glY = h - y - 1;
          gl.readPixels(x, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const total = pixel[0] + pixel[1] + pixel[2];
          results.push({
            name, x, y,
            r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3],
            brightness: total,
            isBlack: total < 10,
            isDark: total < 60,
          });
        }
      }

      return { samples: results, width: w, height: h, hasGL: !!gl };
    });

    console.log('\n--- Pixel Analysis ---');
    console.log(`Canvas: ${pixelData.width}x${pixelData.height}, WebGL: ${pixelData.hasGL}`);
    if (pixelData.samples) {
      const DIVIDER_RGB = { r: 34, g: 34, b: 68 }; // 0x222244
      for (const s of pixelData.samples) {
        const isDivider = Math.abs(s.r - DIVIDER_RGB.r) < 5 && Math.abs(s.g - DIVIDER_RGB.g) < 5 && Math.abs(s.b - DIVIDER_RGB.b) < 5;
        const status = s.isBlack ? '⚫ BLACK' : isDivider ? '🟦 DIVIDER-COLOR (no game content!)' : s.isDark ? '🌑 DARK' : '✅ HAS GAME CONTENT';
        console.log(`  ${status} at ${s.name} (${s.x},${s.y}): rgb(${s.r},${s.g},${s.b}) brightness=${s.brightness}`);
      }

      // Detect patterns
      const left = pixelData.samples.filter(s => s.name.startsWith('P1'));
      const right = pixelData.samples.filter(s => s.name.startsWith('P2'));
      const leftHasContent = left.some(s => s.brightness > 60);
      const rightHasContent = right.some(s => s.brightness > 60);

      console.log('\n--- Verdict ---');
      if (!leftHasContent && !rightHasContent) {
        console.log('❌ BROKEN: Both viewports appear to show only divider color (no game content)');
        console.log('   Possible cause: game not rendering, or viewport/scissor issue');
      } else if (!leftHasContent && rightHasContent) {
        console.log('❌ BROKEN: Left viewport (P1) has no content, right (P2) does');
        console.log('   Possible cause: viewport not reset before composer.render() — only P2 viewport gets composited');
      } else if (leftHasContent && !rightHasContent) {
        console.log('❌ BROKEN: Right viewport (P2) has no content, left (P1) does');
      } else {
        console.log('✅ BOTH viewports appear to have game content');
        console.log('   But visual inspection of screenshot is needed to confirm correct split');
      }
    }

    // Check for HUD elements
    const hudInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-player]')).map(el => {
        const rect = el.getBoundingClientRect();
        return { player: el.dataset.player, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      });
    });
    if (hudInfo.length > 0) {
      console.log('\n--- HUD Positions ---');
      hudInfo.forEach(h => console.log(`  Player ${h.player}: x=${h.x}, y=${h.y}, w=${h.w}, h=${h.h}`));
    }

    if (errors.length > 0) {
      console.log('\n--- Browser Errors ---');
      errors.forEach(e => console.log(`  ${e}`));
    }

    await browser.close();
    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    try { await browser.close(); } catch {}
    process.exit(1);
  }
}

main();
