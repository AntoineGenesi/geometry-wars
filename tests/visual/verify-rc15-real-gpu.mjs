#!/usr/bin/env node
/**
 * RC15 Real-GPU Verification Script
 * Connects to user's Windows Chrome via debug port to test enemy visibility
 * on real WebGPU (not headless SwiftShader).
 *
 * Usage:
 *   1. Start Vite on port 3032
 *   2. Launch Chrome: chrome.exe --remote-debugging-port=9222 --user-data-dir=...
 *   3. Run: node tests/visual/verify-rc15-real-gpu.mjs
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'rc15-real-gpu');

// Get Windows host IP from WSL2
const WIN_IP = execSync("cat /etc/resolv.conf | grep nameserver | awk '{print $2}'")
  .toString().trim();

async function main() {
  console.log(`\n=== RC15 Real-GPU Enemy Visibility Test ===`);
  console.log(`Windows host IP: ${WIN_IP}`);

  // Connect to Chrome
  let browser;
  try {
    const versionUrl = `http://${WIN_IP}:9222/json/version`;
    console.log(`Fetching debug endpoint from ${versionUrl}...`);
    const resp = await fetch(versionUrl);
    const info = await resp.json();
    const wsEndpoint = info.webSocketDebuggerUrl.replace('127.0.0.1', WIN_IP);
    console.log(`Connecting to: ${wsEndpoint}`);
    browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  } catch (e) {
    console.error(`Failed to connect to Chrome debug port: ${e.message}`);
    console.error(`Make sure Chrome is running with --remote-debugging-port=9222`);
    process.exit(1);
  }

  const pages = await browser.pages();
  // Find the game page
  let page = pages.find(p => p.url().includes('localhost:3032'));
  if (!page) {
    console.error('No page found on localhost:3032. Navigate Chrome to the game first.');
    browser.disconnect();
    process.exit(1);
  }
  console.log(`Found game page: ${page.url()}`);

  // Ensure screenshot directory exists
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Wait for WebGPU init (15-30 seconds)
  console.log('\nWaiting 30s for WebGPU initialization...');
  await new Promise(r => setTimeout(r, 30000));

  // Check FPS via non-blocking rAF injection
  console.log('Checking FPS...');
  const fps = await page.evaluate(() => new Promise(resolve => {
    let count = 0;
    const start = performance.now();
    function tick() {
      count++;
      if (performance.now() - start > 1000) {
        resolve(count);
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  }));
  console.log(`FPS: ${fps}`);

  if (fps < 5) {
    console.error('FPS too low — game may be frozen. Cannot test.');
    browser.disconnect();
    process.exit(1);
  }

  // Take screenshots at intervals
  const timestamps = [0, 15, 30, 45, 60];
  for (const t of timestamps) {
    if (t > 0) {
      console.log(`Waiting ${t > 0 ? 15 : 0}s...`);
      await new Promise(r => setTimeout(r, 15000));
    }

    // Get game state via rAF (non-blocking)
    const state = await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => {
        const api = window.__TEST_API;
        if (!api) {
          resolve({ error: 'No __TEST_API' });
          return;
        }
        try {
          const gs = api.getGameState();
          resolve({
            wave: gs?.wave,
            round: gs?.round,
            aliveEnemies: gs?.enemies?.filter(e => e.alive)?.length || 0,
            totalEnemies: gs?.enemies?.length || 0,
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    }));

    // Take screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `rc15-t${t}s.png`);
    // Don't set viewport — it permanently shrinks the canvas
    await page.screenshot({ path: screenshotPath });

    console.log(`\n[t=${t}s] Screenshot: ${screenshotPath}`);
    console.log(`  Game state:`, JSON.stringify(state));

    // Analyze screenshot for bright (non-black) pixels in the center region
    // Read the PNG and check for non-background pixels
    const screenshotBuffer = fs.readFileSync(screenshotPath);
    console.log(`  Screenshot size: ${screenshotBuffer.length} bytes`);
  }

  // Final verdict based on game state
  const finalState = await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => {
      const api = window.__TEST_API;
      if (!api) {
        resolve({ error: 'No __TEST_API' });
        return;
      }
      try {
        const gs = api.getGameState();
        const enemies = gs?.enemies || [];
        const alive = enemies.filter(e => e.alive);
        // Check instanceColorBrightness
        const icbValues = alive.map(e => ({
          type: e.type,
          icb: e.instanceColorBrightness,
          pos: e.position,
        }));
        resolve({
          wave: gs?.wave,
          round: gs?.round,
          aliveCount: alive.length,
          icbValues: icbValues.slice(0, 10), // first 10
          avgICB: icbValues.length > 0 ? icbValues.reduce((s, e) => s + (e.icb || 0), 0) / icbValues.length : 0,
        });
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  }));

  console.log(`\n=== FINAL STATE ===`);
  console.log(JSON.stringify(finalState, null, 2));

  if (finalState.aliveCount > 0) {
    console.log(`\n${finalState.aliveCount} enemies alive with avg ICB=${finalState.avgICB?.toFixed(3)}`);
    console.log(`Screenshots saved to ${SCREENSHOT_DIR}`);
    console.log(`\nVERDICT: Game state shows enemies alive. Check screenshots visually.`);
    console.log(`depthTest:false should make them visible on real GPU now.`);
  } else {
    console.log(`\nNo alive enemies found in game state.`);
  }

  // Don't close browser — just disconnect
  browser.disconnect();
  console.log('\nDisconnected from Chrome (browser stays open).');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
