/**
 * Comprehensive weapon playground test:
 * 1. Navigate full flow: Start Menu -> Weapon Database -> weapon card -> TRY IT
 * 2. Verify canvas renders
 * 3. Close and reopen playground (toggle test)
 * 4. Test ESC key behavior
 * 5. Close modal and open a different weapon
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const URL = 'http://localhost:3000';
const SCREENSHOT_DIR = join(__dirname, 'test-screenshots');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const fs = await import('fs');
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--enable-webgl2',
      '--ignore-gpu-blocklist',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--window-size=1280,900',
      '--enable-unsafe-swiftshader',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', err => {
    pageErrors.push(err.message);
    console.error('  !! PAGE ERROR:', err.message.substring(0, 200));
  });
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  let testsPassed = 0;
  let testsFailed = 0;

  function pass(name) {
    testsPassed++;
    console.log(`  [PASS] ${name}`);
  }
  function fail(name, detail) {
    testsFailed++;
    console.log(`  [FAIL] ${name}: ${detail}`);
  }

  try {
    // ============ SETUP ============
    console.log('\n=== SETUP ===');
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      if (await page.evaluate(() => !!document.getElementById('start-menu'))) break;
    }
    await page.evaluate(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) ls.remove();
    });
    await sleep(500);

    // ============ TEST 1: Basic flow works ============
    console.log('\n=== TEST 1: Basic flow (Start -> Wiki -> Card -> TRY IT) ===');

    // Click Weapon Database
    await page.click('#weapon-info-btn');
    await sleep(1000);

    const wikiVisible = await page.evaluate(() => {
      const ww = document.getElementById('weapon-wiki');
      return ww && !ww.classList.contains('hidden');
    });
    wikiVisible ? pass('Weapon wiki opens') : fail('Weapon wiki opens', 'Wiki not visible');

    // Click first weapon card (Standard/Blaster)
    await page.click('#weapon-wiki .weapon-card');
    await sleep(1000);

    const modalOpen = await page.$('.weapon-modal-overlay');
    modalOpen ? pass('Weapon modal opens') : fail('Weapon modal opens', 'No modal overlay');

    // Scroll and click TRY IT
    await page.evaluate(() => {
      const m = document.querySelector('.weapon-modal');
      if (m) m.scrollTop = m.scrollHeight;
    });
    await sleep(300);

    pageErrors.length = 0;
    await page.click('.playground-toggle');
    await sleep(3000);

    const pg1 = await page.evaluate(() => {
      const pc = document.querySelector('.playground-container');
      return {
        visible: pc?.classList.contains('visible'),
        hasCanvas: !!pc?.querySelector('canvas'),
        childCount: pc?.children.length,
      };
    });

    pg1.visible ? pass('Playground container visible') : fail('Playground container visible', JSON.stringify(pg1));
    pg1.hasCanvas ? pass('Playground has canvas') : fail('Playground has canvas', JSON.stringify(pg1));
    (pg1.childCount === 4) ? pass('Playground has 4 children (canvas+stats+popup+hint)') : fail('Playground children', `Got ${pg1.childCount}`);
    (pageErrors.length === 0) ? pass('No errors on playground creation') : fail('No errors', pageErrors.join('; '));

    // Scroll to see playground
    await page.evaluate(() => {
      const m = document.querySelector('.weapon-modal');
      if (m) m.scrollTop = m.scrollHeight;
    });
    await sleep(500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'test1-playground.png') });

    // ============ TEST 2: Click to play activates game ============
    console.log('\n=== TEST 2: Click to play activates game ===');

    const canvasEl = await page.$('.playground-container canvas');
    if (canvasEl) {
      await canvasEl.click();
      await sleep(2000);

      const gameActive = await page.evaluate(() => {
        const pc = document.querySelector('.playground-container');
        if (!pc) return null;
        // Check hint is hidden
        const divs = pc.querySelectorAll('div');
        let hintHidden = true;
        for (const d of divs) {
          if (d.textContent?.includes('CLICK TO PLAY')) {
            hintHidden = getComputedStyle(d).display === 'none';
          }
        }
        // Check stats are updating
        const timeSpan = pc.querySelector('#pg-time');
        return {
          hintHidden,
          timeText: timeSpan?.textContent,
        };
      });

      gameActive?.hintHidden ? pass('Hint overlay hidden after click') : fail('Hint hidden', JSON.stringify(gameActive));

      const timeRunning = gameActive?.timeText && parseFloat(gameActive.timeText) > 0;
      timeRunning ? pass('Timer is running') : fail('Timer running', `timeText=${gameActive?.timeText}`);

      await page.screenshot({ path: join(SCREENSHOT_DIR, 'test2-playing.png') });
    } else {
      fail('Click to play', 'No canvas element found');
    }

    // ============ TEST 3: Close and reopen playground ============
    console.log('\n=== TEST 3: Toggle playground (close and reopen) ===');

    // Click CLOSE DEMO
    await page.evaluate(() => {
      const m = document.querySelector('.weapon-modal');
      if (m) m.scrollTop = m.scrollHeight;
    });
    await sleep(300);

    const closeBtn = await page.$('.playground-toggle');
    if (closeBtn) {
      const btnText = await page.evaluate(el => el.textContent, closeBtn);
      console.log(`  Button text before close: "${btnText}"`);

      pageErrors.length = 0;
      await closeBtn.click();
      await sleep(1000);

      const afterClose = await page.evaluate(() => {
        const pc = document.querySelector('.playground-container');
        const btn = document.querySelector('.playground-toggle');
        return {
          containerVisible: pc?.classList.contains('visible'),
          hasCanvas: !!pc?.querySelector('canvas'),
          btnText: btn?.textContent,
          btnActive: btn?.classList.contains('active'),
        };
      });

      !afterClose.containerVisible ? pass('Container hidden after close') : fail('Container hidden', JSON.stringify(afterClose));
      (afterClose.btnText === 'TRY IT') ? pass('Button text reset to TRY IT') : fail('Button text', afterClose.btnText);
      !afterClose.btnActive ? pass('Button not active after close') : fail('Button active state', JSON.stringify(afterClose));
      (pageErrors.length === 0) ? pass('No errors on close') : fail('Close errors', pageErrors.join('; '));

      // Reopen
      console.log('  Reopening...');
      pageErrors.length = 0;
      await page.click('.playground-toggle');
      await sleep(3000);

      const afterReopen = await page.evaluate(() => {
        const pc = document.querySelector('.playground-container');
        return {
          visible: pc?.classList.contains('visible'),
          hasCanvas: !!pc?.querySelector('canvas'),
          childCount: pc?.children.length,
        };
      });

      afterReopen.visible ? pass('Container visible after reopen') : fail('Reopen visible', JSON.stringify(afterReopen));
      afterReopen.hasCanvas ? pass('Canvas exists after reopen') : fail('Reopen canvas', JSON.stringify(afterReopen));
      (pageErrors.length === 0) ? pass('No errors on reopen') : fail('Reopen errors', pageErrors.join('; '));

      await page.screenshot({ path: join(SCREENSHOT_DIR, 'test3-reopened.png') });
    } else {
      fail('Toggle test', 'No toggle button found');
    }

    // ============ TEST 4: Close modal properly disposes playground ============
    console.log('\n=== TEST 4: Close modal disposes playground ===');

    pageErrors.length = 0;
    // Click the X button on the modal
    const closeModalBtn = await page.$('.weapon-modal .modal-close');
    if (closeModalBtn) {
      await closeModalBtn.click();
      await sleep(500);

      const modalGone = await page.evaluate(() => !document.querySelector('.weapon-modal-overlay'));
      modalGone ? pass('Modal closed') : fail('Modal closed', 'Modal still present');
      (pageErrors.length === 0) ? pass('No errors on modal close') : fail('Modal close errors', pageErrors.join('; '));
    } else {
      fail('Close modal', 'No close button found');
    }

    // ============ TEST 5: Open a different weapon (Spread Shot) ============
    console.log('\n=== TEST 5: Open different weapon (2nd card) ===');

    const cards = await page.$$('#weapon-wiki .weapon-card');
    if (cards.length >= 2) {
      pageErrors.length = 0;
      await cards[1].click();
      await sleep(1000);

      const weaponName = await page.evaluate(() => {
        const name = document.querySelector('.weapon-modal .modal-weapon-name');
        return name?.textContent;
      });
      console.log(`  Opened weapon: ${weaponName}`);

      // Scroll and click TRY IT
      await page.evaluate(() => {
        const m = document.querySelector('.weapon-modal');
        if (m) m.scrollTop = m.scrollHeight;
      });
      await sleep(300);
      await page.click('.playground-toggle');
      await sleep(3000);

      const pg2 = await page.evaluate(() => {
        const pc = document.querySelector('.playground-container');
        return {
          visible: pc?.classList.contains('visible'),
          hasCanvas: !!pc?.querySelector('canvas'),
        };
      });

      pg2.visible ? pass(`Playground visible for ${weaponName}`) : fail('Playground visible', JSON.stringify(pg2));
      pg2.hasCanvas ? pass(`Canvas exists for ${weaponName}`) : fail('Canvas exists', JSON.stringify(pg2));
      (pageErrors.length === 0) ? pass('No errors for different weapon') : fail('Errors', pageErrors.join('; '));

      await page.evaluate(() => {
        const m = document.querySelector('.weapon-modal');
        if (m) m.scrollTop = m.scrollHeight;
      });
      await sleep(500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'test5-different-weapon.png') });
    } else {
      fail('Different weapon', `Only ${cards.length} cards found`);
    }

    // ============ SUMMARY ============
    console.log('\n========================================');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('========================================');

    if (testsFailed > 0) {
      console.log('\nAll console errors:');
      for (const e of consoleErrors) console.log('  ', e.substring(0, 200));
    }

  } catch (err) {
    console.error('\nTest error:', err.message);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'error.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
