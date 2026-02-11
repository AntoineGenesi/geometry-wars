/**
 * Visual test: Pill map A+D glitch reproduction
 *
 * Reproduces the user's exact scenario:
 * - Quick Game → Waves → Pill surface
 * - Press A+D simultaneously
 * - Check if player glitches/loops in same spot
 *
 * Creates timestamped session directory with screenshots + analysis.
 */

import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TASK_SLUG = process.argv[2] || 'pill-map-ad-glitch';
const COMMIT_HASH = process.argv[3] || 'HEAD';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const SESSION_DIR = join(ROOT, 'test-screenshots/sessions', `${timestamp}_${TASK_SLUG}`);

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const URL = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function screenshot(page, name) {
  const path = join(SESSION_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return path;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🎮 Pill Map A+D Glitch Visual Test');
  console.log(`📁 Session: ${SESSION_DIR}`);

  await mkdir(SESSION_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('console', msg => console.log(`  [console.${msg.type()}]`, msg.text()));
  page.on('pageerror', err => {
    console.error(`  [ERROR]`, err.message);
    errors.push(err.message);
  });

  try {
    console.log('\n1. Loading game...');
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await screenshot(page, '01-loaded');

    console.log('\n2. Navigating to Quick Game → Waves → Pill');
    await sleep(500);

    // Click "Quick Game"
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const quickGame = buttons.find(b => b.textContent.includes('Quick Game'));
      if (quickGame) quickGame.click();
    });
    await sleep(500);
    await screenshot(page, '02-quick-game-menu');

    // Select "Waves" mode
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const waves = buttons.find(b => b.textContent === 'Waves');
      if (waves) waves.click();
    });
    await sleep(300);
    await screenshot(page, '03-waves-selected');

    // Find and click Pill surface
    await page.evaluate(() => {
      const surfaces = Array.from(document.querySelectorAll('.surface-option, button'));
      const pill = surfaces.find(s => s.textContent.toLowerCase().includes('pill') ||
                                      s.textContent.toLowerCase().includes('capsule'));
      if (pill) {
        pill.scrollIntoView({ block: 'center' });
        pill.click();
      } else {
        throw new Error('Could not find Pill surface option');
      }
    });
    await sleep(300);
    await screenshot(page, '04-pill-selected');

    // Click START
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const start = buttons.find(b => b.textContent === 'START');
      if (start) {
        start.scrollIntoView({ block: 'center' });
        start.click();
      } else {
        throw new Error('Could not find START button');
      }
    });

    console.log('\n3. Waiting for game to start...');
    await sleep(2000); // Let game initialize (SwiftShader is slow)
    await screenshot(page, '05-game-started');

    console.log('\n4. Taking baseline screenshot (no input)');
    await sleep(500);
    await screenshot(page, '06-baseline');

    console.log('\n5. Pressing A+D simultaneously for 3 seconds');
    // Hold A+D for 3 seconds (SwiftShader runs at ~7fps, so 3 real seconds ≈ 21 game frames)
    await page.keyboard.down('a');
    await page.keyboard.down('d');
    await sleep(3000);
    await screenshot(page, '07-ad-pressed-3sec');

    await sleep(1000);
    await screenshot(page, '08-ad-pressed-4sec');

    await sleep(1000);
    await screenshot(page, '09-ad-pressed-5sec');

    console.log('\n6. Releasing A+D');
    await page.keyboard.up('a');
    await page.keyboard.up('d');
    await sleep(500);
    await screenshot(page, '10-ad-released');

    console.log('\n7. Rapid A/D alternation test (5 cycles)');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('a');
      await sleep(200);
      await screenshot(page, `11-rapid-a-${i}`);
      await page.keyboard.up('a');

      await page.keyboard.down('d');
      await sleep(200);
      await screenshot(page, `12-rapid-d-${i}`);
      await page.keyboard.up('d');
    }

    console.log('\n8. Final state');
    await sleep(500);
    await screenshot(page, '13-final');

    // Generate RESULTS.md skeleton
    const results = `# Visual Test: ${TASK_SLUG}
**Timestamp:** ${timestamp}
**Commit:** ${COMMIT_HASH}
**Goal:** Reproduce user's "A+D on pill map causes glitching/looping" bug

## Test Scenario
1. Quick Game → Waves → Pill surface
2. A+D held simultaneously for 5 seconds
3. Rapid A/D alternation (5 cycles)

## Screenshots
- 01-loaded.png — Initial page load
- 02-quick-game-menu.png — Quick Game menu
- 03-waves-selected.png — Waves mode selected
- 04-pill-selected.png — Pill surface selected
- 05-game-started.png — Game initialized
- 06-baseline.png — Before input
- 07-ad-pressed-3sec.png — A+D held for 3 seconds
- 08-ad-pressed-4sec.png — A+D held for 4 seconds
- 09-ad-pressed-5sec.png — A+D held for 5 seconds
- 10-ad-released.png — After releasing A+D
- 11-rapid-a-*.png — Rapid alternation (A pressed)
- 12-rapid-d-*.png — Rapid alternation (D pressed)
- 13-final.png — Final state

## Console Errors
${errors.length > 0 ? errors.map(e => `- ${e}`).join('\n') : '(none)'}

## Visual Analysis

### Attempt 1: A+D Simultaneous
**What I see:** TODO - FILL THIS IN BY READING THE SCREENSHOTS
**Player position:** TODO - describe where player is on the pill surface
**Movement observed:** TODO - is player moving? stuck? glitching?
**Verdict:** TODO - PASS/FAIL with reasoning

### Attempt 2: Rapid Alternation
**What I see:** TODO
**Movement observed:** TODO
**Verdict:** TODO

## Conclusion
TODO - Does the bug reproduce? What exactly is happening? Does it match user's description?
`;

    await writeFile(join(SESSION_DIR, 'RESULTS.md'), results);
    console.log(`\n✅ Results template: ${SESSION_DIR}/RESULTS.md`);

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    await screenshot(page, 'ERROR');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
