import puppeteer from 'puppeteer';

const CHROME_PATH = process.env.CHROME_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
];

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: LAUNCH_ARGS,
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });

const port = process.env.PORT || '3013';
const surface = process.env.SURFACE || 'sphere';
console.log(`Navigating to game on ${surface}...`);
await page.goto(`http://localhost:${port}/?quickStart=true&surface=${surface}&debug=true&testMode=true`, { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('Waiting 20s for enemies to spawn and dimming to settle...');
await new Promise(r => setTimeout(r, 20000));

// Take screenshot
const screenshotPath = `/tmp/dimming-${surface}.png`;
await page.screenshot({ path: screenshotPath });
console.log(`Screenshot: ${screenshotPath}`);

// Get telemetry
const result = await page.evaluate(() => {
  const t = window.__GAME_TELEMETRY;
  if (!t) return { error: 'No telemetry' };

  const enemies = t.enemies || [];
  return {
    enemyCount: enemies.length,
    playerU: t.player?.u,
    playerV: t.player?.v,
    enemies: enemies.map(e => ({
      type: e.type,
      u: e.u,
      v: e.v,
      opacity: e.opacity,
      distance: e.distance,
    })),
  };
});

if (result.error) {
  console.log(`Error: ${result.error}`);
} else {
  console.log(`Enemy count: ${result.enemyCount}`);
  console.log(`Player UV: (${result.playerU?.toFixed(3)}, ${result.playerV?.toFixed(3)})`);

  let brightCount = 0, dimCount = 0, medCount = 0;
  for (const e of result.enemies) {
    if (e.opacity > 0.8) brightCount++;
    else if (e.opacity < 0.3) dimCount++;
    else medCount++;
  }
  console.log(`\nSummary: ${brightCount} bright (>0.8), ${medCount} medium (0.3-0.8), ${dimCount} dim (<0.3)`);
  console.log(`\nSample bright enemies:`);
  for (const e of result.enemies.filter(e => e.opacity > 0.8).slice(0, 3)) {
    console.log(`  ${e.type} UV(${e.u?.toFixed(3)}, ${e.v?.toFixed(3)}) opacity=${e.opacity?.toFixed(3)}`);
  }
  console.log(`Sample dim enemies:`);
  for (const e of result.enemies.filter(e => e.opacity < 0.3).slice(0, 3)) {
    console.log(`  ${e.type} UV(${e.u?.toFixed(3)}, ${e.v?.toFixed(3)}) opacity=${e.opacity?.toFixed(3)}`);
  }
}

// Analyze screenshot brightness: sample center vs edges
const centerBrightness = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const w = canvas.width, h = canvas.height;
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const r = 60; // center region radius

  let centerSum = 0, centerPx = 0;
  let edgeSum = 0, edgePx = 0;

  // Sample center
  const centerData = ctx.getImageData(cx - r, cy - r, r * 2, r * 2).data;
  for (let i = 0; i < centerData.length; i += 4) {
    const brightness = (centerData[i] + centerData[i + 1] + centerData[i + 2]) / 3;
    if (brightness > 5) { // skip black pixels
      centerSum += brightness;
      centerPx++;
    }
  }

  // Sample edges (top strip)
  const topData = ctx.getImageData(0, 0, w, 40).data;
  for (let i = 0; i < topData.length; i += 4) {
    const brightness = (topData[i] + topData[i + 1] + topData[i + 2]) / 3;
    if (brightness > 5) {
      edgeSum += brightness;
      edgePx++;
    }
  }
  // Bottom strip
  const botData = ctx.getImageData(0, h - 40, w, 40).data;
  for (let i = 0; i < botData.length; i += 4) {
    const brightness = (botData[i] + botData[i + 1] + botData[i + 2]) / 3;
    if (brightness > 5) {
      edgeSum += brightness;
      edgePx++;
    }
  }

  return {
    centerAvg: centerPx > 0 ? centerSum / centerPx : 0,
    centerPixels: centerPx,
    edgeAvg: edgePx > 0 ? edgeSum / edgePx : 0,
    edgePixels: edgePx,
  };
});

if (centerBrightness) {
  console.log(`\nVisual brightness analysis:`);
  console.log(`  Center: avg=${centerBrightness.centerAvg.toFixed(1)} (${centerBrightness.centerPixels} non-black pixels)`);
  console.log(`  Edge: avg=${centerBrightness.edgeAvg.toFixed(1)} (${centerBrightness.edgePixels} non-black pixels)`);
  const ratio = centerBrightness.edgeAvg > 0 ? centerBrightness.centerAvg / centerBrightness.edgeAvg : 0;
  console.log(`  Center/Edge ratio: ${ratio.toFixed(2)} (>1.5 means dimming is visible)`);
}

await browser.close();
