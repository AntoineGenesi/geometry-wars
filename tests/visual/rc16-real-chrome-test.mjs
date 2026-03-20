#!/usr/bin/env node
// RC16 real Chrome test — click Resume, wait for round 3, take screenshots
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WIN_IP = fs.readFileSync('/etc/resolv.conf', 'utf8').match(/nameserver\s+(\S+)/)?.[1];
const OUT_DIR = path.join(process.cwd(), 'test-screenshots', 'rc16-verify');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log(`Connecting to Chrome at ${WIN_IP}:9222...`);
  const verJson = await fetch(`http://${WIN_IP}:9222/json/version`).then(r => r.json());
  const wsUrl = verJson.webSocketDebuggerUrl.replace('127.0.0.1', WIN_IP);

  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('localhost:3032')) || pages[0];

  console.log('Connected. Waiting 20s for WebGPU init...');
  await new Promise(r => setTimeout(r, 20000));

  // Click RESUME button to unpause
  console.log('Clicking Resume button...');
  try {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.includes('RESUME')) { b.click(); return 'clicked'; }
      }
      // Try data-action
      const resume = document.querySelector('[data-action="resume"]');
      if (resume) { resume.click(); return 'clicked data-action'; }
      return 'not found';
    });
  } catch(e) { console.log('Resume click error:', e.message); }

  await new Promise(r => setTimeout(r, 3000));

  // Click again in case it didn't work
  try {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.includes('RESUME')) { b.click(); return; }
      }
    });
  } catch(e) {}

  // Take screenshots every 10s for 2 minutes (should get to round 3)
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const shotPath = path.join(OUT_DIR, `rc16-v2-${i}.png`);
    await page.screenshot({ path: shotPath });
    console.log(`Shot ${i} saved`);
  }

  console.log('Done. Disconnecting.');
  browser.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
