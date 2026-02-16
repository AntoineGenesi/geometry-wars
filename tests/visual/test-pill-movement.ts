/**
 * Visual test for player movement oscillation on pill surface
 * Tests the fix for Session 20 bug: forward movement zigzags left/right
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3004;
const BASE_URL = `http://localhost:${PORT}`;

async function testPillMovement() {
  console.log('Starting pill movement oscillation test...');

  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader-webgl',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Navigate to the game
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for game to load
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForTimeout(2000); // Let WebGL initialize

    // Start game with pill surface
    console.log('Starting game with pill surface...');
    await page.evaluate(() => {
      const startBtn = document.querySelector('button') as HTMLButtonElement;
      if (startBtn) startBtn.click();
    });
    await page.waitForTimeout(1000);

    // Select pill surface
    await page.evaluate(() => {
      const surfaceSelect = document.querySelector('select') as HTMLSelectElement;
      if (surfaceSelect) {
        surfaceSelect.value = 'pill';
        surfaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);

    // Confirm mode selection
    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent?.includes('Confirm')) as HTMLButtonElement;
      if (confirmBtn) confirmBtn.click();
    });
    await page.waitForTimeout(2000); // Wait for game to start

    // Record initial player position
    const initialPos = await page.evaluate(() => {
      // @ts-ignore
      const player = window.__gameContext?.player;
      if (player && player.mesh) {
        return {
          x: player.mesh.position.x,
          y: player.mesh.position.y,
          z: player.mesh.position.z,
        };
      }
      return null;
    });

    if (!initialPos) {
      throw new Error('Could not access player position');
    }

    console.log('Initial player position:', initialPos);

    // Simulate forward movement (W key) for 3 seconds
    // Record position every 100ms to detect oscillation
    console.log('Simulating forward movement for 3 seconds...');
    const positions: Array<{ x: number; y: number; z: number; time: number }> = [];

    await page.keyboard.down('w');

    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(100);
      const pos = await page.evaluate(() => {
        // @ts-ignore
        const player = window.__gameContext?.player;
        if (player && player.mesh) {
          return {
            x: player.mesh.position.x,
            y: player.mesh.position.y,
            z: player.mesh.position.z,
          };
        }
        return null;
      });
      if (pos) {
        positions.push({ ...pos, time: i * 100 });
      }
    }

    await page.keyboard.up('w');

    console.log(`Recorded ${positions.length} position samples`);

    // Analyze for oscillation
    // If movement is smooth, the lateral displacement should be minimal and monotonic
    // If oscillating, we'll see periodic left/right shifts

    // Project positions onto a plane perpendicular to average movement direction
    if (positions.length < 3) {
      throw new Error('Not enough position samples');
    }

    const avgMovement = {
      x: positions[positions.length - 1].x - positions[0].x,
      y: positions[positions.length - 1].y - positions[0].y,
      z: positions[positions.length - 1].z - positions[0].z,
    };

    const movementLen = Math.sqrt(avgMovement.x ** 2 + avgMovement.y ** 2 + avgMovement.z ** 2);
    console.log('Total displacement:', movementLen.toFixed(3), 'units');

    if (movementLen < 0.5) {
      throw new Error('Player did not move significantly (might be stuck or controls not working)');
    }

    // Calculate lateral deviation (perpendicular to average movement direction)
    const lateralDeviations: number[] = [];
    for (let i = 1; i < positions.length - 1; i++) {
      const delta = {
        x: positions[i].x - positions[0].x,
        y: positions[i].y - positions[0].y,
        z: positions[i].z - positions[0].z,
      };

      // Project onto movement direction
      const dot = (delta.x * avgMovement.x + delta.y * avgMovement.y + delta.z * avgMovement.z) / (movementLen * movementLen);

      // Perpendicular component
      const lateral = {
        x: delta.x - dot * avgMovement.x,
        y: delta.y - dot * avgMovement.y,
        z: delta.z - dot * avgMovement.z,
      };

      const lateralDist = Math.sqrt(lateral.x ** 2 + lateral.y ** 2 + lateral.z ** 2);
      lateralDeviations.push(lateralDist);
    }

    const maxLateralDev = Math.max(...lateralDeviations);
    const avgLateralDev = lateralDeviations.reduce((a, b) => a + b, 0) / lateralDeviations.length;

    console.log('Lateral deviation analysis:');
    console.log('  Max:', maxLateralDev.toFixed(4), 'units');
    console.log('  Avg:', avgLateralDev.toFixed(4), 'units');

    // Check for oscillation pattern
    // Count direction changes in lateral deviation
    let directionChanges = 0;
    for (let i = 1; i < lateralDeviations.length - 1; i++) {
      const prev = lateralDeviations[i - 1];
      const curr = lateralDeviations[i];
      const next = lateralDeviations[i + 1];

      // Peak or valley detection
      if ((curr > prev && curr > next) || (curr < prev && curr < next)) {
        directionChanges++;
      }
    }

    console.log('  Direction changes:', directionChanges);

    // Screenshot for manual verification
    const screenshotDir = path.join(__dirname, '../../test-screenshots/sessions/s20-movement-fix');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, 'pill-forward-movement.png');
    await page.screenshot({ path: screenshotPath });
    console.log('Screenshot saved:', screenshotPath);

    // Verdict
    console.log('\n=== TEST VERDICT ===');

    const OSCILLATION_THRESHOLD = 0.1; // Max acceptable lateral deviation
    const CHANGE_THRESHOLD = 5; // Max acceptable direction changes in 30 samples

    if (maxLateralDev < OSCILLATION_THRESHOLD && directionChanges < CHANGE_THRESHOLD) {
      console.log('✓ PASS: Movement is smooth, no significant oscillation detected');
      console.log('  - Max lateral deviation:', maxLateralDev.toFixed(4), '< threshold', OSCILLATION_THRESHOLD);
      console.log('  - Direction changes:', directionChanges, '< threshold', CHANGE_THRESHOLD);
    } else {
      console.log('✗ FAIL: Oscillation detected');
      console.log('  - Max lateral deviation:', maxLateralDev.toFixed(4), '(threshold:', OSCILLATION_THRESHOLD + ')');
      console.log('  - Direction changes:', directionChanges, '(threshold:', CHANGE_THRESHOLD + ')');
      throw new Error('Movement oscillation still present');
    }

  } finally {
    await browser.close();
  }
}

// Run test
testPillMovement()
  .then(() => {
    console.log('\nTest completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nTest failed:', err.message);
    process.exit(1);
  });
