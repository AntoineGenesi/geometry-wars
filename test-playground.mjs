/**
 * Puppeteer test for WeaponPlayground.
 */
import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const GAME_URL = 'http://localhost:3002/';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--disable-web-security',
      '--window-size=1280,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const consoleErrors = [];
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    consoleLogs.push(`[${msg.type()}] ${text}`);
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  console.log('1. Navigating to game...');
  try {
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    console.log('   Navigation warning:', e.message);
  }
  await sleep(5000);
  await page.screenshot({ path: '/tmp/pg-01-start-menu.png' });
  console.log('   Screenshot: /tmp/pg-01-start-menu.png');

  // Check page state
  const pageState = await page.evaluate(() => {
    return {
      title: document.title,
      bodyChildren: document.body.children.length,
      canvasCount: document.querySelectorAll('canvas').length,
      hasStartMenu: !!document.getElementById('start-menu'),
      hasWeaponWiki: !!document.getElementById('weapon-wiki'),
    };
  });
  console.log('   Page state:', JSON.stringify(pageState));

  // Find weapon-related clickable elements
  console.log('2. Looking for Weapon Database button...');
  const clickableItems = await page.evaluate(() => {
    const items = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const style = window.getComputedStyle(el);
      if ((style.cursor === 'pointer' || el.tagName === 'BUTTON') && el.offsetParent !== null) {
        const text = el.textContent?.trim() || '';
        if (text.length > 0 && text.length < 100) {
          let childHasPointer = false;
          for (const child of el.children) {
            const cStyle = window.getComputedStyle(child);
            if ((cStyle.cursor === 'pointer' || child.tagName === 'BUTTON') && child.textContent?.trim().length > 0) {
              childHasPointer = true;
              break;
            }
          }
          if (!childHasPointer) {
            items.push({
              tag: el.tagName,
              text,
              id: el.id || '',
              cls: (el.className?.substring?.(0, 60)) || '',
            });
          }
        }
      }
    }
    return items;
  });
  console.log('   Clickable items:', JSON.stringify(clickableItems, null, 2));

  // Click the Weapon Database button
  const clickResult = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text === 'weapon database' || text === 'weapons' || text.includes('weapon database')) {
        let isLeaf = true;
        for (const child of el.children) {
          if (child.textContent?.trim().toLowerCase().includes('weapon')) {
            isLeaf = false;
            break;
          }
        }
        if (isLeaf || el.children.length === 0) {
          el.click();
          return `Clicked: "${el.textContent?.trim()}" (${el.tagName}.${el.className})`;
        }
      }
    }
    return 'NOT_FOUND';
  });
  console.log('   Click result:', clickResult);

  await sleep(1500);
  await page.screenshot({ path: '/tmp/pg-02-after-weapon-click.png' });

  // Check wiki visibility
  const wikiState = await page.evaluate(() => {
    const wiki = document.getElementById('weapon-wiki');
    if (!wiki) return { exists: false };
    return {
      exists: true,
      hidden: wiki.classList.contains('hidden'),
      display: window.getComputedStyle(wiki).display,
    };
  });
  console.log('   Wiki state:', JSON.stringify(wikiState));

  // If still hidden, try to force-show it
  if (wikiState.exists && wikiState.hidden) {
    console.log('   Wiki is hidden, forcing show...');
    await page.evaluate(() => {
      const wiki = document.getElementById('weapon-wiki');
      if (wiki) wiki.classList.remove('hidden');
    });
    await sleep(500);
  }

  // Click a weapon card
  console.log('3. Clicking first weapon card...');
  const cardResult = await page.evaluate(() => {
    const cards = document.querySelectorAll('.weapon-card');
    if (cards.length === 0) return 'No cards found';
    cards[0].click();
    return `Clicked: ${cards[0].dataset.weaponType} (${cards.length} total)`;
  });
  console.log('   Card result:', cardResult);

  await sleep(1000);
  await page.screenshot({ path: '/tmp/pg-03-weapon-modal.png' });

  // Check modal
  const modalExists = await page.evaluate(() => !!document.querySelector('.weapon-modal-overlay'));
  console.log('   Modal exists:', modalExists);

  if (modalExists) {
    // Scroll modal to see TRY IT button
    await page.evaluate(() => {
      const modal = document.querySelector('.weapon-modal');
      if (modal) modal.scrollTop = modal.scrollHeight;
    });
    await sleep(500);
    await page.screenshot({ path: '/tmp/pg-03b-modal-scrolled.png' });

    // Click TRY IT
    console.log('4. Clicking TRY IT...');
    await page.evaluate(() => {
      const btn = document.querySelector('.playground-toggle');
      if (btn) btn.click();
    });

    await sleep(5000);
    await page.screenshot({ path: '/tmp/pg-04-playground.png' });

    // Check playground state
    const pgState = await page.evaluate(() => {
      const container = document.querySelector('.playground-container');
      if (!container) return { error: 'no container' };
      return {
        visible: container.classList.contains('visible'),
        display: window.getComputedStyle(container).display,
        childCount: container.children.length,
        hasCanvas: !!container.querySelector('canvas'),
        canvasSize: container.querySelector('canvas') ? {
          w: container.querySelector('canvas').width,
          h: container.querySelector('canvas').height,
        } : null,
        html: container.innerHTML.substring(0, 500),
      };
    });
    console.log('   Playground state:', JSON.stringify(pgState, null, 2));

    if (pgState.hasCanvas) {
      console.log('5. Clicking playground canvas to activate...');
      const rect = await page.evaluate(() => {
        const c = document.querySelector('.playground-container');
        const r = c?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      });
      if (rect) {
        await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
        await sleep(3000);
        await page.screenshot({ path: '/tmp/pg-05-active.png' });
        console.log('   Screenshot: /tmp/pg-05-active.png');
      }
    }
  }

  // Errors summary
  console.log('\n=== CONSOLE ERRORS ===');
  for (const err of consoleErrors) {
    console.log('  ', err.substring(0, 300));
  }
  if (consoleErrors.length === 0) console.log('  None');

  console.log('\n=== KEY LOGS ===');
  for (const log of consoleLogs) {
    const l = log.toLowerCase();
    if (l.includes('error') || l.includes('warn') || l.includes('exception') || l.includes('uncaught') || l.includes('failed')) {
      console.log('  ', log.substring(0, 300));
    }
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
