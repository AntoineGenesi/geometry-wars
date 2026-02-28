#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = resolve(__dirname, '../../test-screenshots/s42-04h');
const BASE_URL = 'http://localhost:3049';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: [
    '--enable-webgl','--use-gl=swiftshader','--use-angle=swiftshader',
    '--enable-unsafe-swiftshader','--no-sandbox','--disable-setuid-sandbox',
    '--disable-dev-shm-usage','--window-size=1280,900',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', err => errors.push(err.message));

const clickByText = async (text) => {
  await page.evaluate((t) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent?.includes(t));
    if (btn) btn.click();
    else console.warn('Button not found:', t);
  }, text);
  await sleep(800);
};

console.log('[1] Loading page...');
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(3000);
await page.screenshot({ path: `${SCREENSHOT_DIR}/01-start-menu.png` });

console.log('[2] Quick Game...');
await clickByText('QUICK GAME');
await sleep(1500);

console.log('[3] Click START (sphere is default surface, Waves is default mode)...');
await clickByText('START');
await sleep(3000);
await page.screenshot({ path: `${SCREENSHOT_DIR}/02-after-start-click.png` });

console.log('[4] Waiting 25s for gameplay (SwiftShader slow)...');
await sleep(25000);
await page.screenshot({ path: `${SCREENSHOT_DIR}/03-gameplay-25s.png` });

await browser.close();
if (errors.length) console.log('JS errors:', errors.slice(0,3));
console.log(`Screenshots → ${SCREENSHOT_DIR}`);
