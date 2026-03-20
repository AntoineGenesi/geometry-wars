#!/usr/bin/env node
// Quick single screenshot — connect, screenshot, disconnect immediately
// Minimizes impact on game FPS
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const WIN_IP = fs.readFileSync('/etc/resolv.conf', 'utf8').match(/nameserver\s+(\S+)/)?.[1];
const OUT_DIR = path.join(process.cwd(), 'test-screenshots', 'rc16-verify');
fs.mkdirSync(OUT_DIR, { recursive: true });

const label = process.argv[2] || 'quick';

async function main() {
  const verJson = await fetch(`http://${WIN_IP}:9222/json/version`).then(r => r.json());
  const wsUrl = verJson.webSocketDebuggerUrl.replace('127.0.0.1', WIN_IP);
  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('localhost:3032')) || pages[0];

  const shotPath = path.join(OUT_DIR, `rc16-${label}.png`);
  await page.screenshot({ path: shotPath });
  console.log(`Screenshot saved: ${shotPath}`);

  browser.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
