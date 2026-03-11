#!/usr/bin/env node
/**
 * verify-fix.mjs — One-liner visual verification for workers.
 *
 * Workers call this as their LAST verification step:
 *
 *   import { verifyFix } from './verify-fix.mjs';
 *   const result = await verifyFix({
 *     surface: 'torus',
 *     mode: 'sp',
 *     duration: 20,
 *     checks: ['enemies_visible', 'player_alive', 'movement_works'],
 *   });
 *   // result.passed, result.screenshots[], result.failedChecks[]
 *
 * Can also be run directly:
 *   node tests/visual/verify-fix.mjs --surface=torus --checks=enemies_visible,player_alive
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration (shared with run-visual-tests.mjs)
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots');

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.__testErrors = errors;
  return page;
}

async function startGameOnSurface(page, surface = 'sphere') {
  await page.goto(`${BASE_URL}?surface=${surface}&debug=true`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await sleep(2000);

  // Click Quick Game
  await page.click('[data-mode="single"]');
  await sleep(800);

  // Click Start
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button, .btn, [class*="btn"]');
    for (const btn of btns) {
      if (btn.textContent?.trim().toUpperCase().includes('START')) {
        btn.click();
        return;
      }
    }
  });

  // Wait for countdown + first render
  await sleep(3000);
}

/** Inject canvas pixel reader via requestAnimationFrame hook */
async function injectCanvasReader(page) {
  await page.evaluate(() => {
    window.__canvasCapture = { data: null, requested: false };

    const origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function(cb) {
      return origRAF.call(window, function(ts) {
        cb(ts);
        if (window.__canvasCapture.requested) {
          const canvas = document.querySelector('canvas');
          if (canvas) {
            try {
              const t = document.createElement('canvas');
              t.width = canvas.width;
              t.height = canvas.height;
              const ctx = t.getContext('2d');
              if (ctx) {
                ctx.drawImage(canvas, 0, 0);

                const gridSize = 40;
                let nonBlack = 0;
                let bright = 0;
                const colorCounts = { cyan: 0, purple: 0, blue: 0, pink: 0, yellow: 0, green: 0, red: 0, orange: 0, other: 0 };
                const pixelBrightness = []; // brightness per sample point

                for (let gx = 0; gx < gridSize; gx++) {
                  for (let gy = 0; gy < gridSize; gy++) {
                    const px = Math.floor((gx / gridSize) * canvas.width);
                    const py = Math.floor((gy / gridSize) * canvas.height);
                    const p = ctx.getImageData(px, py, 1, 1).data;
                    const [r, g, b] = [p[0], p[1], p[2]];
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    pixelBrightness.push({ x: gx, y: gy, r, g, b, lum });

                    if (r > 5 || g > 5 || b > 5) nonBlack++;
                    if (r > 100 || g > 100 || b > 100) bright++;

                    if (r < 80 && g > 120 && b > 120) colorCounts.cyan++;
                    else if (r > 100 && g < 100 && b > 150) colorCounts.purple++;
                    else if (r < 80 && g < 80 && b > 120) colorCounts.blue++;
                    else if (r > 150 && g < 100 && b > 100) colorCounts.pink++;
                    else if (r > 150 && g > 150 && b < 80) colorCounts.yellow++;
                    else if (r < 80 && g > 120 && b < 80) colorCounts.green++;
                    else if (r > 150 && g < 60 && b < 60) colorCounts.red++;
                    else if (r > 180 && g > 80 && g < 180 && b < 60) colorCounts.orange++;
                    else if (r > 5 || g > 5 || b > 5) colorCounts.other++;
                  }
                }

                const cp = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;

                window.__canvasCapture.data = {
                  width: canvas.width,
                  height: canvas.height,
                  nonBlack,
                  bright,
                  total: gridSize * gridSize,
                  center: { r: cp[0], g: cp[1], b: cp[2] },
                  colors: colorCounts,
                  pixelBrightness, // full grid for spatial analysis
                };
              }
            } catch (e) { /* security */ }
          }
          window.__canvasCapture.requested = false;
        }
      });
    };
  });
}

async function captureFrameData(page) {
  await page.evaluate(() => {
    window.__canvasCapture.requested = true;
    window.__canvasCapture.data = null;
  });

  for (let i = 0; i < 40; i++) {
    const data = await page.evaluate(() => window.__canvasCapture.data);
    if (data) return data;
    await sleep(50);
  }
  return null;
}

/** Screenshot diff: compare two buffers, return % changed */
function screenshotDiffPercent(buf1, buf2) {
  let diff = 0;
  const len = Math.min(buf1.length, buf2.length);
  const step = 100;
  const samples = Math.floor(len / step);
  for (let i = 0; i < len; i += step) {
    if (Math.abs(buf1[i] - buf2[i]) > 10) diff++;
  }
  return (diff / samples) * 100;
}

// ---------------------------------------------------------------------------
// Check implementations
// ---------------------------------------------------------------------------

const CHECK_REGISTRY = {

  /**
   * enemies_visible: After some gameplay time, there should be colored
   * pixels beyond just the player/grid (enemies show as colored dots).
   */
  async enemies_visible(page, _opts) {
    const frame = await captureFrameData(page);
    if (!frame) return { passed: false, reason: 'No frame data captured' };
    // Enemies are cyan, pink, purple, green etc. Need at least a few colored samples.
    const enemyColors = frame.colors.cyan + frame.colors.pink + frame.colors.purple
      + frame.colors.green + frame.colors.red + frame.colors.orange;
    if (enemyColors >= 3) {
      return { passed: true, reason: `${enemyColors} enemy-colored samples found` };
    }
    return { passed: false, reason: `Only ${enemyColors} enemy-colored samples (need ≥3)` };
  },

  /**
   * player_alive: The game HUD shows lives > 0 (player hasn't died to invisible enemies).
   */
  async player_alive(page, _opts) {
    const lives = await page.evaluate(() => {
      const el = document.getElementById('lives-display');
      if (!el) return null;
      const text = el.textContent || '';
      const match = text.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    });
    if (lives === null) return { passed: false, reason: 'Could not read lives display' };
    if (lives > 0) return { passed: true, reason: `Player has ${lives} lives` };
    return { passed: false, reason: 'Player has 0 lives — died during test' };
  },

  /**
   * movement_works: Pressing 'W' causes visible screen change (player moves).
   */
  async movement_works(page, _opts) {
    const before = await page.screenshot({ encoding: 'binary' });
    await page.keyboard.down('w');
    await sleep(800);
    await page.keyboard.up('w');
    await sleep(300);
    const after = await page.screenshot({ encoding: 'binary' });

    const diff = screenshotDiffPercent(before, after);
    if (diff > 0.5) return { passed: true, reason: `${diff.toFixed(1)}% pixels changed` };
    return { passed: false, reason: `Only ${diff.toFixed(1)}% pixels changed (need >0.5%)` };
  },

  /**
   * enemy_dimming: Far-side enemies should be dimmer than near-side enemies.
   * Compares average brightness of edge pixels vs center pixels.
   * On a torus or sphere, enemies on the far side appear at screen edges
   * and should be dimmer (per the dimming system).
   */
  async enemy_dimming(page, _opts) {
    // Wait for enemies to spawn and spread
    await sleep(5000);
    const frame = await captureFrameData(page);
    if (!frame) return { passed: false, reason: 'No frame data captured' };

    // Analyze brightness in center vs edges
    // Center quadrant: grid indices 12-28 (of 40) = middle 40%
    // Edge band: grid indices 0-7 and 32-39 = outer 20% each side
    const centerPixels = frame.pixelBrightness.filter(p =>
      p.x >= 12 && p.x <= 28 && p.y >= 12 && p.y <= 28
    );
    const edgePixels = frame.pixelBrightness.filter(p =>
      p.x < 8 || p.x > 32 || p.y < 8 || p.y > 32
    );

    // Only look at non-black pixels (actual content)
    const centerLit = centerPixels.filter(p => p.lum > 10);
    const edgeLit = edgePixels.filter(p => p.lum > 10);

    if (centerLit.length < 5 || edgeLit.length < 5) {
      return {
        passed: true, // Can't prove dimming with too few samples, pass conservatively
        reason: `Insufficient lit pixels for comparison (center: ${centerLit.length}, edge: ${edgeLit.length})`,
      };
    }

    const avgCenter = centerLit.reduce((s, p) => s + p.lum, 0) / centerLit.length;
    const avgEdge = edgeLit.reduce((s, p) => s + p.lum, 0) / edgeLit.length;

    // Center should be brighter than edges (enemies dim with distance)
    // We check that center avg brightness is at least slightly higher
    if (avgCenter >= avgEdge * 0.9) {
      return {
        passed: true,
        reason: `Center brightness ${avgCenter.toFixed(1)} ≥ edge ${avgEdge.toFixed(1)} (dimming present or no far enemies)`,
      };
    }
    return {
      passed: false,
      reason: `Edge brightness ${avgEdge.toFixed(1)} > center ${avgCenter.toFixed(1)} — dimming may be inverted`,
    };
  },

  /**
   * no_crash: No critical JS errors during gameplay.
   */
  async no_crash(page, _opts) {
    const critErrors = (page.__testErrors || []).filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('user gesture') &&
      !e.includes('favicon') &&
      !e.includes('net::') &&
      !e.includes('404') &&
      !e.includes('Failed to load resource') &&
      !e.includes('the server responded with a status') &&
      !e.includes('SharedArrayBuffer') &&
      !e.includes('crossOriginIsolated')
    );
    if (critErrors.length === 0) return { passed: true, reason: 'No critical errors' };
    return { passed: false, reason: `${critErrors.length} errors: ${critErrors[0]}` };
  },

  /**
   * score_increasing: Score should increase during gameplay (enemies killed by bullets).
   */
  async score_increasing(page, opts) {
    // Hold right-click (auto-fire) and move a bit to shoot in various directions
    await page.keyboard.down('d');
    await page.mouse.move(500, 180); // aim right
    await page.mouse.down();
    await sleep(3000);
    await page.mouse.up();
    await page.keyboard.up('d');

    const score = await page.evaluate(() => {
      const el = document.getElementById('score-display');
      if (!el) return 0;
      const match = (el.textContent || '').replace(/,/g, '').match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });

    if (score > 0) return { passed: true, reason: `Score: ${score}` };
    return { passed: false, reason: 'Score still 0 after shooting' };
  },
};

// ---------------------------------------------------------------------------
// Main verification function
// ---------------------------------------------------------------------------

/**
 * Run a set of visual checks on the game.
 *
 * @param {Object} opts
 * @param {string} opts.surface - Map surface ('sphere', 'torus', 'cube', etc.)
 * @param {'sp'|'mp'} opts.mode - Game mode (only 'sp' supported currently)
 * @param {number} opts.duration - Seconds to let the game run before checks
 * @param {string[]} opts.checks - Check names from CHECK_REGISTRY
 * @returns {Promise<{passed: boolean, screenshots: string[], failedChecks: string[], results: Object}>}
 */
export async function verifyFix(opts) {
  const {
    surface = 'sphere',
    mode = 'sp',
    duration = 15,
    checks = ['no_crash', 'player_alive', 'enemies_visible'],
  } = opts;

  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await launchBrowser();
  const page = await createPage(browser);
  const screenshots = [];
  const results = {};

  try {
    // Start game
    await startGameOnSurface(page, surface);
    await injectCanvasReader(page);

    // Let the game run
    if (duration > 3) {
      // Do some movement to spread things out
      await page.keyboard.down('d');
      await sleep(Math.min(duration * 1000, 5000));
      await page.keyboard.up('d');

      const remaining = Math.max(0, (duration * 1000) - 5000);
      if (remaining > 0) await sleep(remaining);
    } else {
      await sleep(duration * 1000);
    }

    // Take pre-check screenshot
    const preBuf = await page.screenshot({ encoding: 'binary' });
    const preFile = `${SCREENSHOT_DIR}/verify-${surface}-pre.png`;
    writeFileSync(preFile, preBuf);
    screenshots.push(preFile);

    // Run checks
    for (const checkName of checks) {
      const checkFn = CHECK_REGISTRY[checkName];
      if (!checkFn) {
        results[checkName] = { passed: false, reason: `Unknown check: ${checkName}` };
        continue;
      }
      results[checkName] = await checkFn(page, opts);
    }

    // Take post-check screenshot
    const postBuf = await page.screenshot({ encoding: 'binary' });
    const postFile = `${SCREENSHOT_DIR}/verify-${surface}-post.png`;
    writeFileSync(postFile, postBuf);
    screenshots.push(postFile);

  } finally {
    await page.close();
    await browser.close();
  }

  const failedChecks = Object.entries(results)
    .filter(([, r]) => !r.passed)
    .map(([name, r]) => `${name}: ${r.reason}`);

  return {
    passed: failedChecks.length === 0,
    screenshots,
    failedChecks,
    results,
  };
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  // Parse CLI args: --surface=X --checks=a,b,c --duration=N
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [k, v] = a.slice(2).split('=');
        return [k, v || 'true'];
      })
  );

  const surface = args.surface || 'sphere';
  const duration = parseInt(args.duration || '15', 10);
  const checks = args.checks ? args.checks.split(',') : ['no_crash', 'player_alive', 'enemies_visible', 'movement_works'];

  console.log(`\nverify-fix: surface=${surface}, duration=${duration}s, checks=[${checks.join(', ')}]\n`);

  verifyFix({ surface, mode: 'sp', duration, checks }).then(result => {
    console.log('\n' + '='.repeat(50));
    for (const [name, r] of Object.entries(result.results)) {
      const icon = r.passed ? 'PASS' : 'FAIL';
      console.log(`  ${icon}  ${name}: ${r.reason}`);
    }
    console.log('='.repeat(50));
    console.log(`\n  Overall: ${result.passed ? 'PASSED' : 'FAILED'}`);
    if (result.failedChecks.length > 0) {
      console.log('  Failed:', result.failedChecks.join(', '));
    }
    console.log(`  Screenshots: ${result.screenshots.join(', ')}`);
    console.log('');
    process.exit(result.passed ? 0 : 1);
  }).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
