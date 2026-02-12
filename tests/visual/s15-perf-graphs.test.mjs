/**
 * Visual test for Performance Graphs fixes (S15)
 *
 * Verifies:
 * 1. Chart titles visible at top of each graph
 * 2. Enemy type graph shows individual bars (not cumulative area)
 * 3. Hover tooltips appear and show correct data
 * 4. All graphs are interactive and responsive
 *
 * Expected results:
 * - FPS chart: title "FPS Over Time", line graph with axis labels
 * - Enemies chart: title "Enemy Count Over Time", line graph
 * - Bullets chart: title "Bullet Count Over Time", line graph
 * - Enemy Types chart: title "Enemy Types Breakdown", individual colored bars (not stacked area)
 */

import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotDir = join(__dirname, 'screenshots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runTest() {
  console.log('[Perf Graphs Test] Starting...');

  // Ensure screenshot directory exists
  await mkdir(screenshotDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
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

  // Navigate to game
  const port = process.env.VITE_PORT || 3035;
  const url = `http://localhost:${port}/`;
  console.log(`[Perf Graphs Test] Navigating to ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000); // Wait for start menu to render

  console.log('[Perf Graphs Test] Start menu loaded, clicking PLAY');

  // Click PLAY button to start game
  await page.evaluate(() => {
    const playButtons = Array.from(document.querySelectorAll('.menu-button'));
    const playButton = playButtons.find(btn => btn.textContent.includes('PLAY'));
    if (playButton) playButton.click();
  });

  await sleep(1000); // Wait for mode selection

  // Click first mode to start game
  await page.evaluate(() => {
    const modeButtons = Array.from(document.querySelectorAll('.mode-option'));
    if (modeButtons[0]) modeButtons[0].click();
  });

  await sleep(4000); // Play for ~4 seconds to generate performance data

  console.log('[Perf Graphs Test] Game started, playing to generate data...');

  // Move player around to generate varied performance data
  await page.keyboard.down('w');
  await sleep(500);
  await page.keyboard.up('w');
  await page.keyboard.down('a');
  await sleep(500);
  await page.keyboard.up('a');
  await page.keyboard.down('d');
  await sleep(500);
  await page.keyboard.up('d');

  await sleep(2000); // More gameplay

  console.log('[Perf Graphs Test] Opening performance graphs (F3)');

  // Press F3 to open performance graphs
  await page.keyboard.press('F3');
  await sleep(1000); // Wait for modal to open and render

  // Take screenshot of FPS chart (default)
  console.log('[Perf Graphs Test] Capturing FPS chart');
  await page.screenshot({ path: join(screenshotDir, 's15-perf-graphs-fps.png') });

  // Click Enemies tab
  console.log('[Perf Graphs Test] Switching to Enemies chart');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.perf-tab'));
    const enemiesTab = tabs.find(tab => tab.getAttribute('data-tab') === 'enemies');
    if (enemiesTab) enemiesTab.click();
  });
  await sleep(500);
  await page.screenshot({ path: join(screenshotDir, 's15-perf-graphs-enemies.png') });

  // Click Bullets tab
  console.log('[Perf Graphs Test] Switching to Bullets chart');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.perf-tab'));
    const bulletsTab = tabs.find(tab => tab.getAttribute('data-tab') === 'bullets');
    if (bulletsTab) bulletsTab.click();
  });
  await sleep(500);
  await page.screenshot({ path: join(screenshotDir, 's15-perf-graphs-bullets.png') });

  // Click Enemy Types tab
  console.log('[Perf Graphs Test] Switching to Enemy Types chart');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.perf-tab'));
    const typesTab = tabs.find(tab => tab.getAttribute('data-tab') === 'types');
    if (typesTab) typesTab.click();
  });
  await sleep(500);
  await page.screenshot({ path: join(screenshotDir, 's15-perf-graphs-types.png') });

  // Simulate hover on types chart to check tooltip
  console.log('[Perf Graphs Test] Simulating hover on Enemy Types chart');
  await page.evaluate(() => {
    const canvas = document.getElementById('perf-graph-canvas');
    if (canvas) {
      // Simulate mousemove event at center of canvas
      const rect = canvas.getBoundingClientRect();
      const event = new MouseEvent('mousemove', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      });
      canvas.dispatchEvent(event);
    }
  });
  await sleep(200);
  await page.screenshot({ path: join(screenshotDir, 's15-perf-graphs-types-hover.png') });

  // Go back to FPS chart and test hover there too
  console.log('[Perf Graphs Test] Testing hover on FPS chart');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.perf-tab'));
    const fpsTab = tabs.find(tab => tab.getAttribute('data-tab') === 'fps');
    if (fpsTab) fpsTab.click();
  });
  await sleep(500);

  await page.evaluate(() => {
    const canvas = document.getElementById('perf-graph-canvas');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const event = new MouseEvent('mousemove', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      });
      canvas.dispatchEvent(event);
    }
  });
  await sleep(200);
  await page.screenshot({ path: join(screenshotDir, 's15-perf-graphs-fps-hover.png') });

  console.log('[Perf Graphs Test] Screenshots captured successfully');
  console.log('[Perf Graphs Test] Screenshots saved to:', screenshotDir);
  console.log('  - s15-perf-graphs-fps.png');
  console.log('  - s15-perf-graphs-enemies.png');
  console.log('  - s15-perf-graphs-bullets.png');
  console.log('  - s15-perf-graphs-types.png');
  console.log('  - s15-perf-graphs-types-hover.png');
  console.log('  - s15-perf-graphs-fps-hover.png');

  await browser.close();
  console.log('[Perf Graphs Test] Complete!');
}

runTest().catch(err => {
  console.error('[Perf Graphs Test] FAILED:', err);
  process.exit(1);
});
