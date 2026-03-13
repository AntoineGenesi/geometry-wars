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

const port = process.env.PORT || '3012';
console.log(`Navigating to game...`);
await page.goto(`http://localhost:${port}/?quickStart=true&surface=sphere&debug=true&testMode=true`, { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('Waiting 20s for enemies...');
await new Promise(r => setTimeout(r, 20000));

// Check telemetry
const result = await page.evaluate(() => {
  const out = {
    globals: Object.keys(window).filter(k => k.startsWith('__')).sort(),
  };

  if (window.__GAME_TELEMETRY) {
    const t = window.__GAME_TELEMETRY;
    const enemies = t.enemies || [];
    out.source = 'telemetry';
    out.enemyCount = enemies.length;
    out.playerU = t.playerU;
    out.playerV = t.playerV;
    out.enemies = enemies.map(e => ({
      type: e.type,
      u: e.u,
      v: e.v,
      opacity: e.opacity,
      distance: e.distance,
    }));
  }

  return out;
});

console.log(`Window globals: ${result.globals.join(', ')}`);

if (result.enemies) {
  console.log(`\nEnemy count: ${result.enemyCount}`);
  console.log(`Player UV: (${result.playerU?.toFixed(3)}, ${result.playerV?.toFixed(3)})`);
  console.log(`\nEnemy opacity values:`);

  let dimCount = 0;
  let brightCount = 0;

  for (const e of result.enemies) {
    const euRaw = Math.abs((e.u || 0) - (result.playerU || 0));
    const eu = Math.min(euRaw, 1 - euRaw);
    const evRaw = Math.abs((e.v || 0) - (result.playerV || 0));
    const uvDist = Math.sqrt(eu * eu + evRaw * evRaw);

    const marker = e.opacity > 0.8 ? 'BRIGHT' : e.opacity > 0.3 ? 'medium' : 'DIM';
    if (e.opacity > 0.8) brightCount++;
    if (e.opacity < 0.3) dimCount++;

    console.log(`  ${marker.padEnd(7)} ${(e.type||'?').padEnd(12)} UV(${(e.u||0).toFixed(3)}, ${(e.v||0).toFixed(3)}) opacity=${(e.opacity||0).toFixed(3)} uvDist=${uvDist.toFixed(3)} dist=${(e.distance||0).toFixed(3)}`);
  }
  console.log(`\nSummary: ${brightCount} bright (>0.8), ${dimCount} dim (<0.3)`);
} else {
  console.log('No telemetry. Taking screenshot...');
  await page.screenshot({ path: '/tmp/dimming-debug.png' });
}

await browser.close();
