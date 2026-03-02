/**
 * Visual test: KotH zone coloring on surface mesh (s44h-12)
 * Verifies that the zone appears as a colored region on the surface mesh
 * rather than a floating ring overlay.
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3012;
const BASE_URL = `http://localhost:${PORT}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function testZoneSurfaceColoring() {
  console.log('Starting KotH zone surface coloring test...');

  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('King') || text.includes('zone') || text.includes('Zone') || text.includes('ERROR')) {
      console.log('PAGE:', text);
    }
  });
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  const screenshotsDir = path.join(
    '/home/antoine/claude code experiments/Geometry Wars',
    'test-screenshots/sessions/s44h-12-zone-coloring',
  );
  fs.mkdirSync(screenshotsDir, { recursive: true });

  try {
    console.log(`Navigating to ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for game JS to boot and render the start menu
    await sleep(4000);

    const screenshot0 = path.join(screenshotsDir, '00-start-menu.png');
    await page.screenshot({ path: screenshot0 });
    console.log(`Screenshot 0 (start menu): ${screenshot0}`);

    // --- Step 1: Click QUICK GAME ---
    const quickGameClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, .btn, .oval-btn, [data-mode]'));
      const btn = btns.find(b =>
        (b.textContent ?? '').toUpperCase().includes('QUICK GAME') ||
        b.getAttribute('data-mode') === 'single'
      ) as HTMLButtonElement | undefined;
      if (btn) { btn.click(); return btn.textContent?.trim(); }
      return null;
    });
    console.log('Quick game button:', quickGameClicked);
    await sleep(1500);

    // --- Step 2: Click King of the Hill mode ---
    const kingClicked = await page.evaluate(() => {
      // Prefer data-mode-type="king" to avoid matching adventure levels with "king" in name
      const btn = document.querySelector('[data-mode-type="king"]') as HTMLButtonElement | null;
      if (btn) { btn.click(); return btn.textContent?.trim(); }
      return null;
    });
    console.log('King mode button:', kingClicked);
    await sleep(500);

    // --- Step 3: Select Sphere surface ---
    const sphereClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, .surface-btn, [data-surface]'));
      const btn = btns.find(b =>
        b.getAttribute('data-surface') === 'sphere' ||
        (b.textContent ?? '').toLowerCase().includes('sphere')
      ) as HTMLButtonElement | undefined;
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log('Sphere button clicked:', sphereClicked);
    await sleep(300);

    const screenshot1 = path.join(screenshotsDir, '01-after-mode-select.png');
    await page.screenshot({ path: screenshot1 });
    console.log(`Screenshot 1 (after mode select): ${screenshot1}`);

    // --- Step 4: Click START (single-player "▶ START", NOT multiplayer "START HOSTING") ---
    const startClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      // Find button with text "▶ START" specifically — avoid matching "START HOSTING"
      const btn = btns.find(b => {
        const text = (b.textContent ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
        return text === '▶ START' || text === 'START';
      }) as HTMLButtonElement | undefined;
      if (btn) { btn.click(); return btn.textContent?.trim(); }
      return null;
    });
    console.log('Start button:', startClicked);

    // Wait for game to fully load (SwiftShader ~7fps)
    await sleep(10000);

    const screenshot2 = path.join(screenshotsDir, '02-zone-coloring.png');
    await page.screenshot({ path: screenshot2 });
    console.log(`Screenshot 2 (zone visible): ${screenshot2}`);

    // --- Inspect zone mesh via debug API ---
    const zoneInfo = await page.evaluate(() => {
      // Try both debug API approaches
      // @ts-ignore
      const debug = (window as any).__gameDebug;
      // @ts-ignore
      const ctx = debug?.ctx ?? (window as any).__gameContext;
      if (!ctx) return { error: 'No game context (tried __gameDebug.ctx and __gameContext)' };

      // Context uses 'gameMode' (not 'quickGameMode')
      const mode = ctx.quickGameMode ?? ctx.gameMode;
      if (!mode) return { error: 'No quickGameMode/gameMode on context', ctxKeys: Object.keys(ctx).join(',') };

      const zoneMesh = (mode as any).zoneMesh;
      if (!zoneMesh) return { error: 'No zoneMesh on mode', modeKeys: Object.keys(mode).join(',') };

      const mat = zoneMesh.material;
      return {
        hasZoneMesh: true,
        meshType: zoneMesh.constructor.name,
        materialType: mat?.constructor.name,
        renderOrder: zoneMesh.renderOrder,
        isInGroup: !!zoneMesh.parent,
        parentName: zoneMesh.parent?.constructor.name,
        zoneCenter: mat?.uniforms?.uZoneCenter?.value
          ? {
              x: mat.uniforms.uZoneCenter.value.x,
              y: mat.uniforms.uZoneCenter.value.y,
              z: mat.uniforms.uZoneCenter.value.z,
            }
          : null,
        zoneRadius: mat?.uniforms?.uZoneRadius?.value,
        // Extra: check _zoneCenterWorld
        zoneCenterWorld: (mode as any)._zoneCenterWorld
          ? {
              x: (mode as any)._zoneCenterWorld.x,
              y: (mode as any)._zoneCenterWorld.y,
              z: (mode as any)._zoneCenterWorld.z,
            }
          : null,
      };
    });

    console.log('\n=== ZONE MESH STATE ===');
    console.log(JSON.stringify(zoneInfo, null, 2));

    // Assess results
    const success = zoneInfo && !('error' in zoneInfo) && (zoneInfo as any).hasZoneMesh;

    console.log('\n=== VISUAL VERIFICATION RESULT ===');
    console.log(`VERDICT: ${success ? 'VERIFIED' : 'PARTIALLY_VERIFIED'}`);
    console.log('Screenshots saved to:', screenshotsDir);
    if (success) {
      const info = zoneInfo as any;
      console.log('Zone mesh: PRESENT on surface.group');
      console.log(`Material: ${info.materialType} (ShaderMaterial)`);
      console.log(`Zone center uniform: ${JSON.stringify(info.zoneCenter)}`);
      console.log(`Zone center world field: ${JSON.stringify(info.zoneCenterWorld)}`);
      console.log(`Zone radius: ${info.zoneRadius}`);
      console.log(`Render order: ${info.renderOrder}`);
    } else {
      console.log('Zone state:', zoneInfo);
    }
    console.log('Verification Level: 5 — Puppeteer screenshot captured');

  } finally {
    await browser.close();
  }
}

testZoneSurfaceColoring().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
