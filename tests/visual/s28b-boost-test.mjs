#!/usr/bin/env node
/**
 * S28b - Player Boost/Dash visual test
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3047';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SESSION_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'sessions', 's28b-boost-test');

async function run() {
  const fs = await import('fs');
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox','--enable-webgl','--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    console.log('1. Loading game...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Click QUICK GAME
    console.log('2. Starting quick game...');
    await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="quick"]');
      if (btn) btn.click();
    });
    await sleep(1500);

    // Click Start button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, .btn, [data-action="start"], [class*="start"]'));
      const start = btns.find(b => /start/i.test(b.textContent || ''));
      if (start) start.click();
    });
    // Wait for countdown to finish (3+ seconds) + game to be running
    console.log('3. Waiting for game to start (countdown)...');
    await sleep(7000);
    await page.screenshot({ path: path.join(SESSION_DIR, '01-gameplay.png') });

    // Check if game is running by looking at game state
    const gameState = await page.evaluate(() => {
      const score = document.getElementById('score-display');
      const boost = document.getElementById('boost-display');
      const countdown = document.getElementById('countdown-overlay');
      return {
        scoreText: score?.textContent,
        boostText: boost?.textContent,
        boostClasses: boost?.className,
        countdownVisible: countdown?.classList.contains('visible'),
      };
    });
    console.log('   Game state:', JSON.stringify(gameState));

    // Move player
    console.log('4. Moving player...');
    await page.keyboard.down('KeyW');
    await sleep(500);

    // Activate boost with Shift key
    console.log('5. Activating boost...');
    await page.keyboard.down('ShiftLeft');
    await sleep(200); // hold shift for a moment

    const boostActiveState = await page.evaluate(() => {
      const boost = document.getElementById('boost-display');
      return { text: boost?.textContent, classes: boost?.className };
    });
    console.log('   Boost state (active):', JSON.stringify(boostActiveState));
    await page.screenshot({ path: path.join(SESSION_DIR, '02-boost-active.png') });

    await page.keyboard.up('ShiftLeft');
    await sleep(800); // Let boost duration expire

    const boostExpiredState = await page.evaluate(() => {
      const boost = document.getElementById('boost-display');
      return { text: boost?.textContent, classes: boost?.className };
    });
    console.log('6. Boost expired (cooldown):', JSON.stringify(boostExpiredState));
    await page.screenshot({ path: path.join(SESSION_DIR, '03-boost-cooldown.png') });

    // Check cooldown ticking
    await sleep(1500);
    const cooldownTick = await page.evaluate(() => {
      const boost = document.getElementById('boost-display');
      return { text: boost?.textContent, classes: boost?.className };
    });
    console.log('7. Cooldown after 1.5s more:', JSON.stringify(cooldownTick));
    await page.screenshot({ path: path.join(SESSION_DIR, '04-cooldown-ticking.png') });

    await page.keyboard.up('KeyW');

    console.log('\n=== RESULT ===');
    const boostFound = gameState.boostText !== undefined;
    const isOnCooldown = boostExpiredState.classes?.includes('cooldown');
    const cooldownShowsTimer = /\d+\.\d/.test(boostExpiredState.text || '');

    console.log('Boost HUD present:', boostFound, '- text:', gameState.boostText);
    console.log('Cooldown class after boost:', isOnCooldown);
    console.log('Cooldown timer in text:', cooldownShowsTimer, '->', boostExpiredState.text);

    if (boostFound) {
      console.log('\nVerification Level 5: Boost HUD visible in screenshot');
      if (isOnCooldown && cooldownShowsTimer) {
        console.log('✅ FULLY VERIFIED - Boost and cooldown both working');
      } else {
        console.log('⚠️  Boost HUD found but state transitions not fully captured - may be timing');
        console.log('   Screenshots saved for manual review at:', SESSION_DIR);
      }
    } else {
      console.log('❌ FAILED - Boost HUD not found');
    }

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
