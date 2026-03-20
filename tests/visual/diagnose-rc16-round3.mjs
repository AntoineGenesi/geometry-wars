#!/usr/bin/env node
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

  // Check if game is already loaded and running
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  if (!currentUrl.includes('gameMode=king')) {
    console.log('Navigating to KotH...');
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  }

  // Wait for WebGPU shader compilation (takes 30-60s of wall time)
  // During this time, game time barely advances
  console.log('Waiting 90s for WebGPU compilation + game start...');
  await sleep(90000);

  // Check if enemies have spawned — use getEnemies() for per-enemy detail
  const state = await evalSafe(page, `
    const a = window.__TEST_API;
    if (!a) return { api: false };
    const g = a.getGameState();
    const enemies = a.getEnemies ? a.getEnemies() : [];
    return {
      api: true,
      alive: enemies.filter(e => e.alive).length,
      total: enemies.length,
      wave: g.wave ?? -1,
      mode: g.mode || 'unknown',
      enemyCount: g.enemies,
    };
  `);
  console.log('State after 90s:', JSON.stringify(state));

  if (!state.alive || state.alive === 0) {
    console.log('Still no enemies. Waiting 60s more...');
    await sleep(60000);

    const state2 = await evalSafe(page, `
      const a = window.__TEST_API;
      if (!a) return { api: false };
      const enemies = a.getEnemies ? a.getEnemies() : [];
      return { alive: enemies.filter(e => e.alive).length, wave: a.getWave ? a.getWave() : -1 };
    `);
    console.log('State after 150s:', JSON.stringify(state2));
  }

  // Now capture snapshots every 3s for 30s
  for (let i = 0; i < 10; i++) {
    const t = i * 3;
    try { await page.screenshot({ path: `${OUT}/snap-${String(t).padStart(2,'0')}s.png` }); } catch(e) {}

    const s = await evalSafe(page, `
      const a = window.__TEST_API;
      if(!a) return null;
      const e = a.getEnemies ? a.getEnemies() : [];
      const g = a.getGameState();
      let alive=0,vis=0,inv=0,mat=0; const det=[], bt={};
      for(const x of e) {
        if(!x.alive)continue; alive++;
        if(x.isMaterializing){mat++;continue;}
        if(x.instanceColorBrightness<0.10)inv++; else vis++;
        det.push({t:x.type,id:x.id,icb:+(x.instanceColorBrightness?.toFixed(3)),
          s:+(x.instanceMatrixScale?.toFixed(3)),b:x.renderBatch,o:+(x.opacity?.toFixed(2))});
      }
      const w = a.getWave ? a.getWave() : (g.wave ?? -1);
      return {alive,vis,inv,mat,det,w};
    `);

    if(s) {
      console.log(`[${t}s] alive=${s.alive} vis=${s.vis} inv=${s.inv} mat=${s.mat} w=${s.w}`);
      if(s.inv>0) for(const d of s.det) if(d.icb<0.10) console.log(`  INV: ${d.t} id=${d.id} icb=${d.icb} s=${d.s} b=${d.b} o=${d.o}`);
      if(i%2===0 && s.det.length>0) console.log(`  first5:${JSON.stringify(s.det.slice(0,5))}`);
    }
    if(i<9) await sleep(3000);
  }
  console.log('done');
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
