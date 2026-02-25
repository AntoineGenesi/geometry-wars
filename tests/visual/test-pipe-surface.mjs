#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const DIR = path.join('test-screenshots', 'sessions', `${new Date().toISOString().split('T')[0]}_pipe-test`);
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

async function test() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    args: ['--use-angle=swiftshader', '--disable-gpu'],
  });

  const page = await browser.newPage();
  page.setViewport({ width: 1024, height: 768 });

  await page.goto('http://localhost:3023/', { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for game to load
  await page.waitForTimeout(3000);

  // Take screenshot before clicking
  await page.screenshot({ path: path.join(DIR, '1-menu.png') });

  // Click on single player
  await page.click('button:has-text("Single Player")') || await page.click('button');
  await page.waitForTimeout(500);

  // Take screenshot of mode selection
  await page.screenshot({ path: path.join(DIR, '2-mode-select.png') });

  // If there's a surface selector, we need to click "Pipe" surface
  // Try to find and click the Pipe surface button
  const surfaces = await page.$eval('body', el => el.innerText);
  console.log('Available text:', surfaces.substring(0, 500));

  // Wait and take another screenshot
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(DIR, '3-pipe-gameplay.png') });

  console.log(`Screenshots saved to ${DIR}`);

  await browser.close();
}

test().catch(console.error);
