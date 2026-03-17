#!/usr/bin/env node
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = 'test-screenshots/menu-grid-verification';

async function verifyMenuGridLines() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--single-process',
      '--no-first-run',
    ],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(10000);

    let surfacesSeen = new Set();
    let screenshots = 0;

    // Take 15 screenshots with different random surfaces
    for (let i = 0; i < 15; i++) {
      try {
        console.log(`Screenshot ${i + 1}/15...`);

        await page.goto('http://localhost:3026', {
          waitUntil: 'networkidle2',
          timeout: 10000
        });

        // Wait for the surface to render and enemies to appear
        await page.evaluate(() => new Promise(r => setTimeout(r, 1500)));

        // Take screenshot
        const filename = path.join(OUTPUT_DIR, `menu-${String(i + 1).padStart(2, '0')}.png`);
        await page.screenshot({ path: filename, fullPage: true });
        screenshots++;

        console.log(`✓ Saved to ${filename}`);
      } catch (e) {
        console.error(`✗ Error on screenshot ${i + 1}:`, e.message);
      }
    }

    console.log(`\n✓ Captured ${screenshots} screenshots`);
    console.log(`  Location: ${OUTPUT_DIR}/`);
    console.log(`  Manually review for visible grid lines on all surfaces`);

  } finally {
    await browser.close();
  }
}

verifyMenuGridLines().catch(console.error);
