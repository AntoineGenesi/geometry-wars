#!/usr/bin/env node
/**
 * BrowserTestHarness — Puppeteer-based test harness for real browser testing.
 *
 * Connects to the actual running game via the debug API.
 * Allows programmatic control and state queries for Level 5 verification.
 *
 * Usage:
 *   import { BrowserTestHarness } from './BrowserTestHarness.mjs';
 *   const harness = new BrowserTestHarness({ surface: 'sphere', seed: 42 });
 *   await harness.start();
 *   await harness.startGame();
 *   const enemies = await harness.getEnemyStates();
 *   await harness.screenshot('my-test');
 *   await harness.stop();
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const NODE_PATH = '/home/antoine/.nvm/versions/node/v20.19.5/bin/node';
const NPM_PATH = '/home/antoine/.nvm/versions/node/v20.19.5/bin/npm';
const DEV_SERVER_PORT = 3000;
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=1280,720',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

// ---------------------------------------------------------------------------
// BrowserTestHarness
// ---------------------------------------------------------------------------

export class BrowserTestHarness {
  constructor({
    surface = 'sphere',
    seed = 12345,
    headless = true,
    viewport = { width: 1280, height: 720 },
  } = {}) {
    this.surface = surface;
    this.seed = seed;
    this.headless = headless;
    this.viewport = viewport;

    this.browser = null;
    this.page = null;
    this.devServerProcess = null;
    this.didStartDevServer = false;

    // Screenshot organization
    const now = new Date();
    const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
    this.sessionName = `${ts}_harness_${surface}_${seed}`;
    this.screenshotDir = resolve(PROJECT_ROOT, 'test-screenshots', 'programmatic', this.sessionName);
    this.screenshotCounter = 0;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Launch browser, start dev server if needed, navigate to game.
   */
  async start() {
    // Create screenshot directory
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true });
    }

    // Check if dev server is already running
    const serverRunning = await this._isServerRunning();
    if (!serverRunning) {
      await this._startDevServer();
      this.didStartDevServer = true;
    }

    // Launch browser
    this.browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: this.headless ? 'new' : false,
      args: LAUNCH_ARGS,
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport(this.viewport);

    // Collect console errors
    this.consoleErrors = [];
    this.page.on('pageerror', err => this.consoleErrors.push(err.message));
    this.page.on('console', msg => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text());
    });
  }

  /**
   * Navigate to game and start playing.
   * Uses quickStart URL to skip menus entirely.
   */
  async startGame() {
    const url = `${BASE_URL}?quickStart=true&surface=${this.surface}&seed=${this.seed}&debug=true`;
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for game to initialize and debug API to be available
    await this._waitForDebugAPI();

    // Wait for countdown (3...2...1...) + first frame
    await this._sleep(3500);
  }

  /**
   * Stop browser and dev server (if we started it).
   */
  async stop() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }

    if (this.didStartDevServer && this.devServerProcess) {
      this._killDevServer();
      this.didStartDevServer = false;
    }
  }

  // -------------------------------------------------------------------------
  // State queries (via debug API)
  // -------------------------------------------------------------------------

  async getEnemyStates() {
    return this.page.evaluate(() => window.__gameDebug.getEnemyStates());
  }

  async getPlayerState() {
    return this.page.evaluate(() => window.__gameDebug.getPlayerState());
  }

  async getBulletStates() {
    return this.page.evaluate(() => window.__gameDebug.getBulletStates());
  }

  async getGameState() {
    return this.page.evaluate(() => window.__gameDebug.getGameState());
  }

  async getCameraState() {
    return this.page.evaluate(() => window.__gameDebug.getCameraState());
  }

  // -------------------------------------------------------------------------
  // Game control
  // -------------------------------------------------------------------------

  async sendInput(key, pressed) {
    await this.page.evaluate(
      ([k, p]) => window.__gameDebug.sendInput(k, p),
      [key, pressed]
    );
  }

  async setMousePosition(x, y) {
    await this.page.evaluate(
      ([mx, my]) => window.__gameDebug.setMousePosition(mx, my),
      [x, y]
    );
  }

  async setMouseDown(down) {
    await this.page.evaluate(
      ([d]) => window.__gameDebug.setMouseDown(d),
      [down]
    );
  }

  async spawnEnemy(type, u, v) {
    await this.page.evaluate(
      ([t, uu, vv]) => window.__gameDebug.spawnEnemy(t, uu, vv),
      [type, u, v]
    );
  }

  async setSeed(seed) {
    await this.page.evaluate(
      ([s]) => window.__gameDebug.setSeed(s),
      [seed]
    );
  }

  async pause() {
    await this.page.evaluate(() => window.__gameDebug.pause());
  }

  async resume() {
    await this.page.evaluate(() => window.__gameDebug.resume());
  }

  // -------------------------------------------------------------------------
  // Deep gameplay support
  // -------------------------------------------------------------------------

  /**
   * Wait for N real game frames.
   * @param n - Number of frames to wait
   */
  async waitFrames(n) {
    const startState = await this.getGameState();
    const targetFrame = startState.frameCount + n;

    let currentFrame = startState.frameCount;
    let attempts = 0;
    const maxAttempts = n * 5; // 5 attempts per frame (avoid infinite loop)

    while (currentFrame < targetFrame && attempts < maxAttempts) {
      await this._sleep(16); // ~60fps frame time
      const state = await this.getGameState();
      currentFrame = state.frameCount;
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error(`waitFrames(${n}) timed out after ${attempts} attempts`);
    }
  }

  /**
   * Fast-forward gameplay for N wall-clock seconds.
   * @param seconds - Real-time seconds to wait
   */
  async fastForward(seconds) {
    await this._sleep(seconds * 1000);
  }

  /**
   * Wait for a specific wave number to be reached.
   * @param n - Wave number to wait for
   */
  async waitForWave(n) {
    let currentWave = 0;
    let previousEnemyCount = -1;
    let waveTransitions = 0;

    // Simple heuristic: when all enemies die, a new wave starts
    // We detect wave transitions by counting enemy spawn/clear cycles
    const maxAttempts = 5000;
    let attempts = 0;

    while (waveTransitions < n && attempts < maxAttempts) {
      const state = await this.getGameState();
      const enemyCount = state.enemyCount;

      // Wave transition: enemies go from 0 to >0
      if (previousEnemyCount === 0 && enemyCount > 0) {
        waveTransitions++;
      }

      previousEnemyCount = enemyCount;
      await this._sleep(100);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error(`waitForWave(${n}) timed out`);
    }
  }

  /**
   * Wait for a specific enemy type to spawn.
   * @param type - Enemy type (e.g., 'grunt', 'wanderer')
   */
  async waitForEnemyType(type) {
    const maxAttempts = 2000; // 200 seconds max
    let attempts = 0;

    while (attempts < maxAttempts) {
      const enemies = await this.getEnemyStates();
      const found = enemies.find(e => e.type.toLowerCase().includes(type.toLowerCase()));
      if (found) {
        return found;
      }
      await this._sleep(100);
      attempts++;
    }

    throw new Error(`waitForEnemyType('${type}') timed out after ${attempts * 100}ms`);
  }

  /**
   * Get current wave information.
   * Returns approximate wave number based on enemy spawns.
   */
  async getWaveInfo() {
    const state = await this.getGameState();
    const enemies = await this.getEnemyStates();

    // Approximate wave from game time (waves ~every 20-30 seconds)
    const approximateWave = Math.floor(state.gameTime / 25) + 1;

    return {
      approximateWave,
      enemyCount: state.enemyCount,
      gameTime: state.gameTime,
      enemies: enemies.map(e => ({ type: e.type, position: e.surfaceUV })),
    };
  }

  /**
   * Auto-screenshot when a specific enemy type spawns.
   * @param type - Enemy type to watch for
   * @param filename - Screenshot filename (without extension)
   */
  async screenshotWhenEnemyAppears(type, filename) {
    const enemy = await this.waitForEnemyType(type);
    await this.screenshot(filename);
    return enemy;
  }

  // -------------------------------------------------------------------------
  // Screenshot
  // -------------------------------------------------------------------------

  async screenshot(name) {
    this.screenshotCounter++;
    const filename = `${String(this.screenshotCounter).padStart(2, '0')}-${name}.png`;
    const filepath = resolve(this.screenshotDir, filename);
    await this.page.screenshot({ path: filepath });
    return filepath;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  async _isServerRunning() {
    try {
      const resp = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async _startDevServer() {
    console.log('[Harness] Starting dev server...');

    this.devServerProcess = spawn(NPM_PATH, ['run', 'dev'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PATH: `${dirname(NODE_PATH)}:${process.env.PATH}`,
      },
      stdio: 'ignore',
      detached: true,
    });

    // Wait for server to be ready
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();
    let ready = false;

    while (Date.now() - startTime < maxWait) {
      ready = await this._isServerRunning();
      if (ready) break;
      await this._sleep(500);
    }

    if (!ready) {
      this._killDevServer();
      throw new Error('Dev server failed to start within 30 seconds');
    }

    console.log('[Harness] Dev server ready');
  }

  _killDevServer() {
    if (this.devServerProcess) {
      try {
        // Kill the entire process group (kills Vite and its children)
        process.kill(-this.devServerProcess.pid, 'SIGTERM');
      } catch (err) {
        // Fallback: kill just the main process
        this.devServerProcess.kill('SIGTERM');
      }
      this.devServerProcess = null;
    }
  }

  async _waitForDebugAPI() {
    const maxAttempts = 100; // 10 seconds
    for (let i = 0; i < maxAttempts; i++) {
      const available = await this.page.evaluate(() => {
        return typeof window.__gameDebug !== 'undefined' &&
               typeof window.__gameDebug.getGameState === 'function';
      });
      if (available) return;
      await this._sleep(100);
    }
    throw new Error('Debug API not available after 10 seconds');
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
