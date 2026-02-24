/**
 * S32 Speed Diagnostic — Measures game time vs wall clock time
 * If game speed < 0.8, something is causing the game to run slow
 */
import puppeteer from 'puppeteer';

const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3006;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-gpu-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  console.log('Loading game...');
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#start-menu', { timeout: 30000 }).catch(() => {});

  // Hide loading screen
  await page.evaluate(() => {
    const ls = document.getElementById('loading-screen');
    if (ls) ls.style.display = 'none';
  });
  await sleep(500);

  // Click Quick Game mode
  await page.evaluate(() => {
    const btn = document.querySelector('[data-mode="single"]');
    if (btn) btn.click();
  });
  await sleep(600);

  // Click start (default surface = sphere)
  console.log('Starting game...');
  await page.evaluate(() => {
    const btn = document.querySelector('#surface-start-btn');
    if (btn) btn.click();
  });

  // Wait for game to load and run for a bit (SwiftShader is slow)
  console.log('Waiting for game to initialize (15s)...');
  await sleep(15000);

  // Inject diagnostic: measure game clock vs wall clock over 15 seconds
  console.log('Running speed diagnostic (15s)...');
  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const wallStart = performance.now();
      let frameCount = 0;
      const frameTimes = [];
      let lastTs = 0;

      // Sample perfLog for game time
      const samples = [];
      function samplePerfLog() {
        const log = (window).__perfLog;
        if (log && log.length > 0) {
          const last = log[log.length - 1];
          samples.push({
            wallMs: performance.now() - wallStart,
            gameTime: last.t,
            fps: last.f,
            enemies: last.e,
            bullets: last.b,
            playerU: last.pu,
            playerV: last.pv,
          });
        }
      }

      const clockTimer = setInterval(samplePerfLog, 1000);

      function frame(ts) {
        frameCount++;
        if (lastTs > 0) frameTimes.push(ts - lastTs);
        lastTs = ts;

        if (performance.now() - wallStart > 15000) {
          clearInterval(clockTimer);
          samplePerfLog();

          const avgFt = frameTimes.length > 0
            ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
          const longFrames = frameTimes.filter(t => t > 50).length;

          let speedRatio = null;
          if (samples.length >= 2) {
            const first = samples[0];
            const last = samples[samples.length - 1];
            const wDelta = (last.wallMs - first.wallMs) / 1000;
            const gDelta = last.gameTime - first.gameTime;
            if (wDelta > 0) speedRatio = gDelta / wDelta;
          }

          resolve({ frameCount, avgFrameTimeMs: avgFt, fps: avgFt > 0 ? 1000/avgFt : 0, longFrames, samples, speedRatio });
          return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  });

  console.log('\n=== RESULTS ===');
  console.log(`Frames: ${result.frameCount} | Avg: ${result.avgFrameTimeMs.toFixed(1)}ms | FPS: ${result.fps.toFixed(1)} | Long (>50ms): ${result.longFrames}`);
  console.log(`Game speed ratio: ${result.speedRatio?.toFixed(3) ?? 'N/A'} (should be ~1.0)`);

  if (result.samples.length > 0) {
    console.log('\nSamples:');
    for (const s of result.samples) {
      console.log(`  Wall ${(s.wallMs/1000).toFixed(1)}s → Game ${s.gameTime?.toFixed(1) ?? '?'}s | FPS: ${s.fps ?? '?'} | Enemies: ${s.enemies ?? '?'} | U: ${s.playerU?.toFixed(3) ?? '?'}, V: ${s.playerV?.toFixed(3) ?? '?'}`);
    }
  }

  if (result.speedRatio !== null) {
    if (result.speedRatio < 0.8) {
      console.log(`\n❌ GAME IS SLOW! Speed ratio: ${result.speedRatio.toFixed(3)}`);
    } else if (result.speedRatio < 0.95) {
      console.log(`\n⚠️  Game is slightly slow: ${result.speedRatio.toFixed(3)}`);
    } else {
      console.log(`\n✅ Game speed is NORMAL: ${result.speedRatio.toFixed(3)}`);
    }
  } else {
    console.log('\n⚠️  Could not measure game speed (no perfLog data). Game may not have started.');
  }

  if (errors.length > 0) {
    console.log(`\nConsole errors (${errors.length}):`);
    errors.slice(0, 5).forEach(e => console.log(`  ${e}`));
  }

  await page.screenshot({ path: 'test-screenshots/s32-speed-diagnostic.png' });
  console.log('\nScreenshot saved.');

  await browser.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
