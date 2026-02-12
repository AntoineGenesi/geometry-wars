#!/usr/bin/env node
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE_URL = 'http://localhost:3033';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

async function verify() {
  console.log('🧪 S15: Player Aura Visual Verification\n');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--window-size=1280,720', '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    console.log('📍 Loading start menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    console.log('📸 Screenshot 0: Start menu');
    await page.screenshot({ path: path.join(screenshotDir, 's15-player-aura-visual-00-start-menu.png') });

    console.log('🎯 Clicking QUICK GAME...');
    await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="single"]');
      if (btn) btn.click();
    });
    await sleep(2000);

    console.log('🎯 Selecting Waves mode...');
    await page.evaluate(() => {
      const waveBtn = document.querySelector('.mode-btn[data-mode-type="waves"]') ||
                      document.querySelector('.mode-btn');
      if (waveBtn) waveBtn.click();
    });
    await sleep(300);

    console.log('🎯 Selecting sphere surface...');
    await page.evaluate(() => {
      const section = document.querySelector('#surface-section');
      if (section) {
        const surfBtn = section.querySelector('.surface-btn[data-surface="sphere"]');
        if (surfBtn) surfBtn.click();
      }
    });
    await sleep(300);

    console.log('🎯 Clicking START...');
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) {
        btn.scrollIntoView();
        btn.click();
      }
    });
    await sleep(8000);

    console.log('📸 Screenshot 1: Gameplay start (no buff)');
    await page.screenshot({ path: path.join(screenshotDir, 's15-player-aura-visual-01-gameplay-start.png') });

    console.log('🎯 Player movement to acquire buff...');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down('w');
      await sleep(150);
    }
    await page.keyboard.up('w');
    await sleep(1500);

    console.log('📸 Screenshot 2: With buff (aura rings visible)');
    await page.screenshot({ path: path.join(screenshotDir, 's15-player-aura-visual-02-with-buff.png') });

    for (let i = 0; i < 2; i++) {
      await page.keyboard.down('d');
      await sleep(150);
    }
    await page.keyboard.up('d');
    await sleep(1500);

    console.log('📸 Screenshot 3: Multi-buff stacking');
    await page.screenshot({ path: path.join(screenshotDir, 's15-player-aura-visual-03-stacking.png') });

    console.log('\n✅ VERIFICATION COMPLETE\n');
    const files = fs.readdirSync(screenshotDir).filter(f => f.startsWith('s15-'));
    files.forEach((f, i) => {
      const sz = (fs.statSync(path.join(screenshotDir, f)).size / 1024).toFixed(1);
      console.log(`  ${i+1}. ${f} (${sz}KB)`);
    });
    process.exit(0);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

verify();
