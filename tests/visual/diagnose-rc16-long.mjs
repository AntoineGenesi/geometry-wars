#!/usr/bin/env node
/**
 * RC16 Long diagnostic — waits for wave 3+ and captures enemy state.
 * Designed to catch invisible enemies that only appear after round 3.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WIN_IP = '172.29.240.1';
const URL = 'http://localhost:3032?quickStart=true&surface=torus&godMode=true&debugVisibility=true&testMode=true&gameMode=king';
const OUT = path.join(process.cwd(), 'tests/visual/rc16-diagnostics');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const resp = await fetch(`http://${WIN_IP}:9222/json/version`);
  const { webSocketDebuggerUrl } = await resp.json();
  const ws = webSocketDebuggerUrl.replace('127.0.0.1', WIN_IP);

  const browser = await puppeteer.connect({
    browserWSEndpoint: ws,
    protocolTimeout: 120000,
  });
  const page = (await browser.pages())[0];

  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  if (!currentUrl.includes('gameMode=king')) {
    console.log('Navigating to KotH...');
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  }

  // Wait for WebGPU compilation
  console.log('Waiting 90s for WebGPU compilation...');
  await sleep(90000);

  // Now poll every 5s for up to 5 minutes, looking for wave 2+ with 15+ enemies
  console.log('Polling for wave 2+ with enemies...');
  let maxWave = 0;
  let maxAlive = 0;

  for (let poll = 0; poll < 60; poll++) {
    const s = await evalSafe(page, `
      const a = window.__TEST_API;
      if (!a) return null;
      const enemies = a.getEnemies ? a.getEnemies() : [];
      const alive = enemies.filter(e => e.alive && !e.isMaterializing);
      const inv = alive.filter(e => e.instanceColorBrightness < 0.10);
      const zeroScale = alive.filter(e => e.instanceMatrixScale < 0.01);
      const w = a.getWave ? a.getWave() : -1;
      return {
        w,
        total: enemies.length,
        alive: alive.length,
        inv: inv.length,
        zeroScale: zeroScale.length,
        mat: enemies.filter(e => e.alive && e.isMaterializing).length,
        invDetail: inv.map(e => ({t:e.type, id:e.id, icb:+e.instanceColorBrightness.toFixed(4), s:+e.instanceMatrixScale.toFixed(3), b:e.renderBatch, o:+e.opacity.toFixed(2)})),
        zeroDetail: zeroScale.map(e => ({t:e.type, id:e.id, icb:+e.instanceColorBrightness.toFixed(4), s:+e.instanceMatrixScale.toFixed(3)})),
        allICB: alive.map(e => +e.instanceColorBrightness.toFixed(4)).sort(),
      };
    `);

    if (s) {
      if (s.w > maxWave) maxWave = s.w;
      if (s.alive > maxAlive) maxAlive = s.alive;

      const hasIssue = s.inv > 0 || s.zeroScale > 0;
      const marker = hasIssue ? ' *** ISSUE ***' : '';
      console.log(`[poll ${poll}, ${poll*5}s] w=${s.w} alive=${s.alive} mat=${s.mat} inv=${s.inv} zs=${s.zeroScale}${marker}`);

      if (hasIssue) {
        console.log(`  INV detail: ${JSON.stringify(s.invDetail)}`);
        console.log(`  ZeroScale detail: ${JSON.stringify(s.zeroDetail)}`);
        // Take screenshot when issue found
        try {
          await page.screenshot({ path: `${OUT}/issue-w${s.w}-poll${poll}.png` });
          console.log(`  Screenshot saved: issue-w${s.w}-poll${poll}.png`);
        } catch(e) {}
      }

      // Log all ICBs every 6th poll (every 30s)
      if (poll % 6 === 0) {
        console.log(`  ICBs: ${JSON.stringify(s.allICB)}`);
      }

      // Take periodic screenshots
      if (poll % 4 === 0) {
        try {
          await page.screenshot({ path: `${OUT}/long-w${s.w}-poll${poll}.png` });
        } catch(e) {}
      }
    } else {
      console.log(`[poll ${poll}] no data`);
    }

    await sleep(5000);
  }

  console.log(`Done. maxWave=${maxWave}, maxAlive=${maxAlive}`);
}

async function evalSafe(page, code) {
  try {
    return await page.evaluate(new Function('return new Promise(r => setTimeout(() => { try { r((function(){' + code + '})()) } catch(e) { r({err:e.message}) } }, 50))'));
  } catch(e) {
    return { err: e.message?.slice(0, 80) };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e=>{console.error(e.message);process.exit(1);});
