import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const viteBin = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const port = Number(process.env.DEV_PORT || 3052);
const baseUrl = `http://127.0.0.1:${port}`;
const surface = process.env.CONTACT_SURFACE || 'sphere';
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = resolve(ROOT, 'reports', `orbiter-contact-live-proof-${runId}.json`);
const screenshotPath = resolve(ROOT, 'reports', `orbiter-contact-live-proof-${runId}.png`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const OTHER_ENEMY_TYPES = [
  'wanderer', 'grunt', 'duck', 'mayfly', 'rocket', 'neutron', 'weaver', 'spinner',
  'snake', 'repulsor', 'gravity_well', 'gravity_well_red', 'gate', 'painter', 'virus',
  'spawner', 'titan_grunt', 'titan_spinner', 'titan_weaver', 'giant_wanderer',
  'giant_rocket', 'giant_snake', 'giant_neutron', 'cluster', 'helix', 'fractal',
  'swarm', 'lurker', 'splitter', 'phaser', 'approach_glow', 'stealth_stalker',
  'fractal_snake', 'prism_lancer', 'shatter_bloom',
];

async function waitForHttp() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Vite did not become ready');
}

async function runCase(page, type, offsetU) {
  return page.evaluate(async ({ enemyType, offset }) => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.clearEvents();
    api.preparePlayerContactProof();
    api.setPlayerPosition(0.5, 0.5);
    const id = api.spawnEnemy(enemyType, 0.5 + offset, 0.5);
    // TestHarnessAPI applies BaseEnemy.applySurfaceTransform after its hold,
    // preserving the same normal-based visual elevation as production.
    api.moveEnemyTo(id, 0.5 + offset, 0.5, 0);
    await new Promise((resolveWait) => setTimeout(resolveWait, 240));
    const enemy = api.getEnemies().find((candidate) => candidate.id === id);
    return {
      offsetU: offset,
      player: api.getPlayerPosition(),
      enemy,
      contacts: api.getRecentDamageEvents(),
      state: api.getGameState(),
    };
  }, { enemyType: type, offset: offsetU });
}

async function runDirectContactSmoke(page, type) {
  return page.evaluate(async (enemyType) => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.clearEvents();
    api.preparePlayerContactProof();
    api.setPlayerPosition(0.5, 0.5);
    const id = api.spawnEnemy(enemyType, 0.5, 0.5);
    api.moveEnemyTo(id, 0.5, 0.5, 0);
    // Phaser deliberately starts ghosted during its fade-in; wait until its
    // production-visible phase before asking CollisionSystem to see it.
    await new Promise((resolveWait) => setTimeout(resolveWait, enemyType === 'phaser' ? 450 : 100));
    return {
      type: enemyType,
      collisionObserved: api.getRecentDamageEvents().some((event) => event.targetId === id && event.source === 'enemy-contact'),
    };
  }, type);
}

const server = spawn('node', [viteBin, '--host', '127.0.0.1', '--port', String(port)], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:${process.env.PATH}` },
});

let browser;
try {
  await waitForHttp();
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}/?quickStart=true&surface=${surface}&renderer=webgl&debug=true&testMode=true&seed=4242`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__TEST_API && window.__GAME_TELEMETRY, { timeout: 30000 });
  // The actual game loop starts only after the 3-2-1 countdown.
  await sleep(4200);

  // This was a live hit before the targeted visual-radius correction.
  const orbiterSafe = await runCase(page, 'orbiter', 0.0031);
  const orbiterContact = await runCase(page, 'orbiter', 0.0001);
  const otherEnemyContacts = [];
  for (const type of OTHER_ENEMY_TYPES) otherEnemyContacts.push(await runDirectContactSmoke(page, type));
  await page.screenshot({ path: screenshotPath });
  const report = {
    url: page.url(),
    surface,
    cases: { orbiterSafe, orbiterContact, otherEnemyContacts },
    checks: {
      gameLoopActive: orbiterSafe.state.gameTime > 3,
      orbiterSafeProducedNoContact: orbiterSafe.contacts.length === 0,
      orbiterProducedCollisionEvent: orbiterContact.contacts.some((event) => event.source === 'enemy-contact'),
      everyDirectBodyContactObserved: otherEnemyContacts
        .filter((result) => result.type !== 'gate') // gate is a deliberate pass-through mechanic
        .every((result) => result.collisionObserved),
    },
    artifacts: { reportPath, screenshotPath },
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
