#!/usr/bin/env node
/**
 * MP Wave 7+ Invisible Enemies Diagnostic (s44r21-01)
 *
 * Connects 2 Puppeteer clients to a running Colyseus server, starts PvPvE,
 * and monitors enemy visibility through wave 7+.
 *
 * Prerequisites:
 *   - Colyseus server running on port 2567 (npm run server)
 *   - Vite dev server running (port 3000+)
 *   - Chrome available
 *
 * Usage:
 *   node tests/visual/mp-wave7-diagnostic.mjs --surface=sphere
 *   node tests/visual/mp-wave7-diagnostic.mjs --surface=mobius
 */

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'tests/visual/screenshots/wave7-diag');

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const COLYSEUS_PORT = 2567;
const VITE_PORT = parseInt(process.env.VITE_PORT || '3001', 10);
const BASE_URL = `http://localhost:${VITE_PORT}`;

// Parse CLI
const args = process.argv.slice(2);
function getArg(name) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.split('=')[1];
  }
  return null;
}
const surface = getArg('surface') || 'sphere';
const targetWave = parseInt(getArg('waves') || '7', 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createPage(browser, label) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  const errors = [];
  const logs = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    // Print s44r21 diagnostic messages
    if (text.includes('[s44r21]')) {
      console.log(`  ${label}: ${text}`);
    }
  });
  page.__errors = errors;
  page.__logs = logs;
  return page;
}

async function navigateToMP(page, label) {
  await page.evaluateOnNewDocument(() => { localStorage.clear(); });
  const url = `${BASE_URL}?mode=network&surface=${surface}&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&debug=true&name=${label}`;
  console.log(`  ${label}: Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(10000); // Wait for game to initialize
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      if (t === '\u2715' || t === 'X' || t === '\u00d7' || t === 'CLOSE' || t === 'SKIP' || t === 'RESUME') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
        }
      }
    }
  });
}

async function clickInfiniteLives(page) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      if (t === '∞' || t === '\u221E') {
        btn.click();
        return true;
      }
    }
    return false;
  });
}

async function clickStartGame(page) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      if (t.includes('START GAME') || t.includes('PLAY AGAIN')) {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
          return true;
        }
      }
    }
    return false;
  });
}

async function getVisStats(page) {
  return page.evaluate(() => window.__ENEMY_VIS_STATS || null);
}

async function getWaveInfo(page) {
  return page.evaluate(() => {
    const debug = window.__gameDebug;
    if (!debug) return null;
    return {
      waveText: typeof debug.getWaveText === 'function' ? debug.getWaveText() : null,
      enemyCount: typeof debug.getEnemyCount === 'function' ? debug.getEnemyCount() : null,
    };
  });
}

async function takeScreenshot(page, name) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  console.log(`  Screenshot: ${path}`);
  return path;
}

async function main() {
  console.log(`\n=== MP Wave 7+ Diagnostic (s44r21-01) ===`);
  console.log(`Surface: ${surface}`);
  console.log(`Target wave: ${targetWave}`);
  console.log(`Server: ws://localhost:${COLYSEUS_PORT}`);
  console.log(`Vite: ${BASE_URL}\n`);

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
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  let hostPage, joinPage;
  const waveVisStats = []; // Track vis stats per wave

  try {
    // Create two pages (host + join)
    hostPage = await createPage(browser, 'Host');
    joinPage = await createPage(browser, 'Join');

    // Navigate both to MP game
    console.log('1. Navigating to MP game...');
    await navigateToMP(hostPage, 'Host');
    await navigateToMP(joinPage, 'Join');

    // Dismiss overlays and click start
    console.log('2. Starting game...');
    await dismissOverlays(hostPage);
    await dismissOverlays(joinPage);

    // Set infinite lives so players survive to wave 7+
    const infClicked = await clickInfiniteLives(hostPage);
    console.log(`  Infinite lives clicked: ${infClicked}`);
    await sleep(500);

    let startClicked = await clickStartGame(hostPage);
    if (!startClicked) {
      await sleep(3000);
      startClicked = await clickStartGame(hostPage);
    }
    console.log(`  Start clicked: ${startClicked}`);

    // Wait for game to actually start
    let gameStarted = false;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const stats = await getVisStats(hostPage);
      if (stats) {
        gameStarted = true;
        console.log(`  Game started! Initial vis stats: wave=${stats.wave} alive=${stats.alive}`);
        break;
      }
      // Also check via wave info
      const info = await getWaveInfo(hostPage);
      if (info?.waveText && !info.waveText.includes('Waiting') && !info.waveText.includes('Connecting')) {
        gameStarted = true;
        console.log(`  Game started! Wave text: ${info.waveText}`);
        break;
      }
    }

    if (!gameStarted) {
      console.log('  ERROR: Game did not start within 20s');
      await takeScreenshot(hostPage, 'host-failed-to-start');
      await takeScreenshot(joinPage, 'join-failed-to-start');
      // Print page content for debugging
      const html = await hostPage.evaluate(() => document.body.innerText.slice(0, 500));
      console.log(`  Page content: ${html}`);
      return;
    }

    // Play through waves, monitoring visibility
    console.log(`\n3. Playing to wave ${targetWave}...\n`);
    const inputKeys = ['w', 'a', 's', 'd'];
    let lastWave = 0;

    // Track which keys are currently pressed per page
    let hostKeyDown = null;
    let joinKeyDown = null;

    for (let tick = 0; tick < 300; tick++) { // Up to 5 min (1s per tick)
      await sleep(1000);

      try {
        // Release previous keys
        if (hostKeyDown) { await hostPage.keyboard.up(hostKeyDown); hostKeyDown = null; }
        if (joinKeyDown) { await joinPage.keyboard.up(joinKeyDown); joinKeyDown = null; }

        // Move players around
        const key = inputKeys[tick % 4];
        await hostPage.keyboard.down(key);
        hostKeyDown = key;
        const key2 = inputKeys[(tick + 2) % 4];
        await joinPage.keyboard.down(key2);
        joinKeyDown = key2;
      } catch (e) { /* ignore input errors */ }

      try {
        // Re-aim and shoot periodically
        if (tick % 3 === 0) {
          const hx = 320 + Math.cos(tick * 0.5) * 120;
          const hy = 180 + Math.sin(tick * 0.5) * 100;
          await hostPage.mouse.move(hx, hy);
          await hostPage.mouse.down();
          const jx = 320 + Math.cos(tick * 0.3 + Math.PI) * 120;
          const jy = 240 + Math.sin(tick * 0.3) * 80;
          await joinPage.mouse.move(jx, jy);
          await joinPage.mouse.down();
        }
      } catch (e) { /* ignore mouse errors */ }

      // Dismiss any overlays that appear
      if (tick % 10 === 0) {
        await dismissOverlays(hostPage).catch(() => {});
        await dismissOverlays(joinPage).catch(() => {});
      }

      // Check wave and visibility stats
      const visStats = await getVisStats(hostPage);

      if (visStats) {
        const currentWave = visStats.wave;

        if (currentWave !== lastWave && currentWave > 0) {
          lastWave = currentWave;
          console.log(`  Wave ${lastWave}: enemies=${visStats.total} alive=${visStats.alive} skipped=${visStats.skipped} NaN=${visStats.nanCount} belowFloor=${visStats.belowFloor} minVis=${visStats.minVis?.toFixed(3)}`);
          waveVisStats.push({ wave: lastWave, ...visStats });

          // Take screenshot at each wave
          await takeScreenshot(hostPage, `wave${lastWave}-host-${surface}`);

          // Check for invisibility
          if (visStats.nanCount > 0) {
            console.log(`  *** NaN DETECTED at wave ${lastWave}! ***`);
          }
          if (visStats.belowFloor > 0) {
            console.log(`  *** BELOW FLOOR at wave ${lastWave}: ${visStats.belowFloor} enemies ***`);
          }
        }

        // Log vis stats periodically even within same wave
        if (tick % 10 === 0) {
          console.log(`  [t=${tick}s] wave=${visStats.wave} alive=${visStats.alive} NaN=${visStats.nanCount} minVis=${visStats.minVis?.toFixed(3)}`);
        }
      }

      // Check if game over
      const waveInfo = await getWaveInfo(hostPage);
      if (waveInfo?.waveText?.includes('GAME OVER') || waveInfo?.waveText?.includes('VOTING')) {
        console.log(`  Game ended at wave ${lastWave}: ${waveInfo.waveText}`);
        await takeScreenshot(hostPage, `gameover-wave${lastWave}-${surface}`);
        await clickInfiniteLives(hostPage).catch(() => {});
        await sleep(500);
        await clickStartGame(hostPage);
        await sleep(3000);
      }

      if (lastWave >= targetWave) {
        console.log(`\n  Reached wave ${targetWave}!`);
        // Stay for a few more seconds to collect data
        for (let j = 0; j < 10; j++) {
          await sleep(1000);
          const stats = await getVisStats(hostPage);
          if (stats) {
            console.log(`  [final t=${tick + j}s] wave=${stats.wave} alive=${stats.alive} NaN=${stats.nanCount} belowFloor=${stats.belowFloor} minVis=${stats.minVis?.toFixed(3)}`);
          }
        }
        await takeScreenshot(hostPage, `wave${targetWave}-final-host-${surface}`);
        await takeScreenshot(joinPage, `wave${targetWave}-final-join-${surface}`);
        break;
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Surface: ${surface}`);
    console.log(`Waves observed: ${waveVisStats.length}`);
    for (const ws of waveVisStats) {
      const status = ws.nanCount > 0 ? 'NaN!' : ws.belowFloor > 0 ? 'BELOW_FLOOR' : ws.alive === 0 ? 'NO_ENEMIES' : 'OK';
      console.log(`  Wave ${ws.wave}: ${status} (alive=${ws.alive}, minVis=${ws.minVis?.toFixed(3)})`);
    }

    // Write results to file
    if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const resultsPath = resolve(SCREENSHOT_DIR, `results-${surface}.json`);
    writeFileSync(resultsPath, JSON.stringify({ surface, targetWave, waveVisStats }, null, 2));
    console.log(`\nResults: ${resultsPath}`);

  } catch (err) {
    console.error('Error:', err.message);
    if (hostPage) await takeScreenshot(hostPage, 'error-host').catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
