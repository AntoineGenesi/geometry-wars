#!/usr/bin/env node
/**
 * scenario-runner.mjs — Puppeteer-based scenario test runner.
 *
 * Loads scenario JSON from tests/visual/scenarios/*.json, launches the game
 * via Puppeteer (testMode=true), feeds scenarios to window.__SCENARIO_ENGINE,
 * collects results and screenshots, generates an HTML report.
 *
 * CODE PATH: Uses REAL game path: ?quickStart=true → src/main.ts → GameLoop.ts
 *            NOT PlaygroundTestHarness / GameInstance (vitest demos only).
 *
 * Usage:
 *   node tests/visual/scenario-runner.mjs                           # Run all
 *   node tests/visual/scenario-runner.mjs --surface=sphere          # Single surface
 *   node tests/visual/scenario-runner.mjs --scenario=tesla_continuous_damage
 *   node tests/visual/scenario-runner.mjs --report                  # HTML report only
 *   node tests/visual/scenario-runner.mjs --list                    # List all scenarios
 */

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCENARIOS_DIR = resolve(__dirname, 'scenarios');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/scenario-runner');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

// Max ms to wait for a scenario to complete
const SCENARIO_TIMEOUT_MS = 30_000;
// ms to wait for game to initialize
const GAME_INIT_WAIT_MS = 4_000;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const argMap = {};
for (const arg of args) {
  const m = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
  if (m) argMap[m[1]] = m[2] ?? true;
}

const filterSurface = argMap['surface'] ?? null;
const filterScenario = argMap['scenario'] ?? null;
const reportOnly = argMap['report'] === true;
const listOnly = argMap['list'] === true;

// ---------------------------------------------------------------------------
// Scenario loading
// ---------------------------------------------------------------------------

function loadScenarios() {
  const scenarios = [];
  if (!existsSync(SCENARIOS_DIR)) return scenarios;
  for (const f of readdirSync(SCENARIOS_DIR)) {
    if (extname(f) !== '.json') continue;
    try {
      const raw = readFileSync(resolve(SCENARIOS_DIR, f), 'utf-8');
      const def = JSON.parse(raw);
      // Support both single scenario object and array
      if (Array.isArray(def)) scenarios.push(...def);
      else scenarios.push(def);
    } catch (e) {
      console.error(`[scenario-runner] Failed to load ${f}: ${e.message}`);
    }
  }
  return scenarios;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });
  return { page, pageErrors };
}

async function navigateToGame(page, surface, extraParams = {}) {
  const params = new URLSearchParams({
    quickStart: 'true',
    surface,
    testMode: 'true',
    debug: 'true',
    ...extraParams,
  });
  const url = `${BASE_URL}?${params}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15_000 });
  await sleep(GAME_INIT_WAIT_MS);
}

async function waitForTestAPI(page, timeoutMs = 8_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => !!(window.__TEST_API && window.__SCENARIO_ENGINE));
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

async function runScenario(page, scenario, surface) {
  console.log(`  [scenario] Running: ${scenario.name} on ${surface}`);

  // Clear prior events in API
  await page.evaluate(() => {
    if (window.__TEST_API) window.__TEST_API.clearEvents();
    if (window.__STATE_RECORDER) window.__STATE_RECORDER.clear();
  });

  // Feed scenario into game process
  const rawScenario = JSON.parse(JSON.stringify(scenario)); // strip any non-serializable

  let result;
  try {
    result = await Promise.race([
      page.evaluate(async (sc) => {
        // Run via TestHarnessAPI.runScenario() which delegates to ScenarioEngine
        return await window.__TEST_API.runScenario(sc);
      }, rawScenario),
      sleep(SCENARIO_TIMEOUT_MS).then(() => ({
        scenarioName: scenario.name,
        passed: false,
        totalSteps: 0,
        stepResults: [],
        startFrame: 0, endFrame: 0, startTime: 0, endTime: 0,
        summary: `TIMEOUT: scenario did not complete within ${SCENARIO_TIMEOUT_MS}ms`,
      })),
    ]);
  } catch (e) {
    result = {
      scenarioName: scenario.name,
      passed: false,
      totalSteps: 0,
      stepResults: [],
      startFrame: 0, endFrame: 0, startTime: 0, endTime: 0,
      summary: `ERROR: ${e.message}`,
    };
  }

  // Capture recording from StateRecorder (best-effort)
  let recording = null;
  try {
    recording = await page.evaluate(() => {
      if (window.__STATE_RECORDER) return window.__STATE_RECORDER.getFullRecording();
      return null;
    });
  } catch { /* recording capture is best-effort */ }

  // Take a screenshot
  let screenshotPath = null;
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const safeName = `${scenario.name.replace(/[^a-z0-9_-]/gi, '_')}_${surface}`;
    screenshotPath = resolve(SCREENSHOT_DIR, `${safeName}.png`);
    await page.screenshot({ path: screenshotPath });
  } catch { /* screenshot is best-effort */ }

  return { result, screenshotPath, recording };
}

// ---------------------------------------------------------------------------
// Run all scenarios on a surface
// ---------------------------------------------------------------------------

async function runScenariosOnSurface(browser, scenarios, surface) {
  const { page, pageErrors } = await createPage(browser);
  const surfaceResults = [];

  try {
    await navigateToGame(page, surface);
    const apiReady = await waitForTestAPI(page);
    if (!apiReady) {
      console.warn(`  [scenario-runner] TestHarnessAPI not ready on ${surface} — skipping`);
      page.close().catch(() => {});
      return scenarios.map(sc => ({
        scenario: sc, surface,
        result: { scenarioName: sc.name, passed: false, totalSteps: 0, stepResults: [], startFrame: 0, endFrame: 0, startTime: 0, endTime: 0, summary: 'API not ready' },
        screenshotPath: null,
        pageErrors: [...pageErrors],
      }));
    }

    for (const scenario of scenarios) {
      const { result, screenshotPath, recording } = await runScenario(page, scenario, surface);
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`    ${status}  ${scenario.name}: ${result.summary}`);
      surfaceResults.push({ scenario, surface, result, screenshotPath, recording, pageErrors: [...pageErrors] });
      pageErrors.length = 0; // reset for next scenario
    }
  } finally {
    page.close().catch(() => {});
  }

  return surfaceResults;
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

/** Inline Canvas2D replay renderer — embedded as a JS string in the HTML report. */
const REPLAY_RENDERER_JS = `
(function() {
  // -------------------------------------------------------------------------
  // Replay player factory
  // -------------------------------------------------------------------------
  window.createReplayPlayer = function(containerId, recording) {
    var container = document.getElementById(containerId);
    if (!container || !recording || !recording.frames || recording.frames.length === 0) {
      if (container) container.innerHTML = '<em style="color:#666">No recording data</em>';
      return;
    }

    var frames = recording.frames;
    var events = recording.events || [];
    var summary = recording.summary || {};

    // Build a quick event lookup by frame
    var eventsByFrame = {};
    events.forEach(function(ev) {
      if (!eventsByFrame[ev.frame]) eventsByFrame[ev.frame] = [];
      eventsByFrame[ev.frame].push(ev);
    });

    var W = 600, H = 430; // canvas size (incl. timeline + controls)
    var PLAY_H = 340;     // playable area height
    var TL_Y = PLAY_H;    // timeline Y
    var TL_H = 30;        // timeline height
    var CTRL_Y = TL_Y + TL_H; // controls Y

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = 'display:block;border:1px solid #333;background:#0a0a12;margin:4px 0';
    container.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    // Controls bar
    var ctrlBar = document.createElement('div');
    ctrlBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap';
    container.appendChild(ctrlBar);

    var btnPlay = document.createElement('button');
    btnPlay.textContent = '▶';
    btnPlay.style.cssText = 'background:#222;color:#fff;border:1px solid #444;padding:3px 10px;cursor:pointer';
    ctrlBar.appendChild(btnPlay);

    var speeds = [0.25, 0.5, 1, 2, 4];
    var speedLabels = ['0.25x','0.5x','1x','2x','4x'];
    var currentSpeed = 1;
    speeds.forEach(function(s, i) {
      var btn = document.createElement('button');
      btn.textContent = speedLabels[i];
      btn.style.cssText = 'background:#' + (s === 1 ? '334' : '222') + ';color:#' + (s === 1 ? 'aaf' : 'aaa') + ';border:1px solid #444;padding:3px 8px;cursor:pointer';
      btn.onclick = function() {
        currentSpeed = s;
        speeds.forEach(function(_, j) { ctrlBar.children[1 + j].style.background = '#222'; ctrlBar.children[1 + j].style.color = '#aaa'; });
        btn.style.background = '#334'; btn.style.color = '#aaf';
      };
      ctrlBar.appendChild(btn);
    });

    var slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = frames.length - 1; slider.value = 0;
    slider.style.cssText = 'flex:1;min-width:100px';
    ctrlBar.appendChild(slider);

    var frameLabel = document.createElement('span');
    frameLabel.style.cssText = 'color:#888;font-family:monospace;font-size:11px;min-width:80px';
    frameLabel.textContent = 'f0';
    ctrlBar.appendChild(frameLabel);

    var infoLabel = document.createElement('span');
    infoLabel.style.cssText = 'color:#666;font-family:monospace;font-size:10px';
    ctrlBar.appendChild(infoLabel);

    // Tooltip div
    var tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:fixed;background:#1a1a2e;border:1px solid #444;color:#ccc;font-family:monospace;font-size:10px;padding:4px 8px;pointer-events:none;display:none;z-index:999;max-width:280px;white-space:pre-wrap';
    document.body.appendChild(tooltip);

    // Playback state
    var frameIdx = 0;
    var playing = false;
    var lastRenderTime = 0;
    var accumMs = 0;
    var frameMs = 1000 / 60; // ~16.67ms per game frame at 60fps

    // UV → canvas coords
    function uvToXY(u, v) {
      var margin = 10;
      return {
        x: margin + u * (W - 2 * margin),
        y: margin + v * (PLAY_H - 2 * margin)
      };
    }

    function drawDiamond(ctx2, x, y, r, color) {
      ctx2.beginPath();
      ctx2.moveTo(x, y - r); ctx2.lineTo(x + r, y);
      ctx2.lineTo(x, y + r); ctx2.lineTo(x - r, y);
      ctx2.closePath();
      ctx2.fillStyle = color;
      ctx2.fill();
    }

    var ENEMY_COLORS = {
      wanderer: '#0ff', spinner: '#f0f', snake: '#a0f', charger: '#fa0',
      blocker: '#0af', squirmer: '#ff0', hexer: '#f88', boss: '#f00'
    };
    function enemyColor(type) {
      var t = type.toLowerCase();
      for (var k in ENEMY_COLORS) { if (t.indexOf(k) !== -1) return ENEMY_COLORS[k]; }
      return '#f80';
    }

    // Flash effects per frame (death=red, damage=orange)
    var flashFrames = {};
    events.forEach(function(ev) {
      if (ev.type === 'death') flashFrames[ev.frame] = 'rgba(255,0,0,0.18)';
      else if (ev.type === 'damage' && !flashFrames[ev.frame]) flashFrames[ev.frame] = 'rgba(255,128,0,0.12)';
    });

    function render() {
      if (frameIdx < 0) frameIdx = 0;
      if (frameIdx >= frames.length) frameIdx = frames.length - 1;

      var fr = frames[frameIdx];
      slider.value = frameIdx;
      frameLabel.textContent = 'f' + fr.frame + ' t' + fr.time.toFixed(2) + 's';
      infoLabel.textContent = 'e:' + fr.enemies.length + ' b:' + fr.bullets.length + ' lives:' + fr.player.lives + ' score:' + fr.player.score;

      ctx.clearRect(0, 0, W, H);

      // Background flash on events
      var flash = flashFrames[fr.frame];
      if (flash) { ctx.fillStyle = flash; ctx.fillRect(0, 0, W, PLAY_H); }

      // Grid (faint UV grid lines)
      ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 0.5;
      for (var g = 0; g <= 1; g += 0.1) {
        var gx = uvToXY(g, 0).x; var gy = uvToXY(0, g).y;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, PLAY_H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // Pickups
      fr.pickups.forEach(function(pk) {
        var p = uvToXY(pk.u, pk.v);
        var isWeapon = pk.type.indexOf('weapon') !== -1;
        drawDiamond(ctx, p.x, p.y, 6, isWeapon ? '#0f8' : '#08f');
      });

      // Enemies
      fr.enemies.forEach(function(en) {
        if (!en.alive) return;
        var p = uvToXY(en.u, en.v);
        var col = enemyColor(en.type);
        ctx.globalAlpha = Math.max(0.2, en.opacity);
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Bullets
      fr.bullets.forEach(function(bl) {
        var p = uvToXY(bl.u, bl.v);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff0'; ctx.fill();
      });

      // Player
      var pp = uvToXY(fr.player.u, fr.player.v);
      if (fr.player.alive) {
        ctx.beginPath(); ctx.arc(pp.x, pp.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
        ctx.strokeStyle = '#88f'; ctx.lineWidth = 2; ctx.stroke();
      } else {
        // Death marker — X
        ctx.strokeStyle = '#f44'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(pp.x-8, pp.y-8); ctx.lineTo(pp.x+8, pp.y+8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pp.x+8, pp.y-8); ctx.lineTo(pp.x-8, pp.y+8); ctx.stroke();
      }

      // Event markers on frame (death=red ring, damage=orange ring)
      var fEvs = eventsByFrame[fr.frame] || [];
      fEvs.forEach(function(ev) {
        if (ev.type === 'death') {
          ctx.beginPath(); ctx.arc(pp.x, pp.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = '#f44'; ctx.lineWidth = 2; ctx.stroke();
        }
      });

      // Timeline bar
      ctx.fillStyle = '#111'; ctx.fillRect(0, TL_Y, W, TL_H);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.strokeRect(0, TL_Y, W, TL_H);

      var tlW = W;
      var totalF = frames.length;
      events.forEach(function(ev) {
        var evFrameIdx = frames.findIndex(function(f) { return f.frame >= ev.frame; });
        if (evFrameIdx < 0) return;
        var tx = (evFrameIdx / totalF) * tlW;
        if (ev.type === 'death') ctx.fillStyle = '#f44';
        else if (ev.type === 'damage') ctx.fillStyle = '#f80';
        else if (ev.type === 'enemy_killed') ctx.fillStyle = '#4f4';
        else if (ev.type === 'weapon_change') ctx.fillStyle = '#44f';
        else ctx.fillStyle = '#888';
        ctx.fillRect(tx - 1, TL_Y + 2, 3, TL_H - 4);
      });

      // Current position in timeline
      var curTx = (frameIdx / totalF) * tlW;
      ctx.fillStyle = '#fff'; ctx.fillRect(curTx - 1, TL_Y, 3, TL_H);
    }

    // Timeline click to scrub
    canvas.addEventListener('click', function(e) {
      var rect = canvas.getBoundingClientRect();
      var cy = e.clientY - rect.top;
      if (cy >= TL_Y && cy <= TL_Y + TL_H) {
        var cx = e.clientX - rect.left;
        frameIdx = Math.round((cx / W) * (frames.length - 1));
        render();
      }
    });

    // Hover on timeline for event tooltip
    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var cy = e.clientY - rect.top;
      var cx = e.clientX - rect.left;
      if (cy >= TL_Y && cy <= TL_Y + TL_H) {
        // Find nearest event
        var hoverFrameIdx = Math.round((cx / W) * (frames.length - 1));
        var hoverFrame = frames[hoverFrameIdx] ? frames[hoverFrameIdx].frame : -1;
        var nearby = events.filter(function(ev) {
          var fi = frames.findIndex(function(f) { return f.frame >= ev.frame; });
          return Math.abs(fi - hoverFrameIdx) < 5;
        });
        if (nearby.length > 0) {
          var lines = nearby.map(function(ev) {
            var d = ev.details || {};
            var extra = '';
            if (d.playerPos) extra += '  player:(' + d.playerPos.u.toFixed(3) + ',' + d.playerPos.v.toFixed(3) + ')\\n';
            if (d.enemyPos) extra += '  enemy:(' + d.enemyPos.u.toFixed(3) + ',' + d.enemyPos.v.toFixed(3) + ')\\n';
            if (d.distance !== undefined) extra += '  dist:' + d.distance.toFixed(4) + '\\n';
            if (d.collisionRadius !== undefined) extra += '  radius:' + d.collisionRadius + '\\n';
            if (d.bulletAge !== undefined) extra += '  bulletAge:' + d.bulletAge.toFixed(3) + 's\\n';
            if (d.weaponType) extra += '  weapon:' + d.weaponType + '\\n';
            if (d.u !== undefined) extra += '  pos:(' + d.u.toFixed(3) + ',' + d.v.toFixed(3) + ')\\n';
            return '[' + ev.frame + '] ' + ev.type + ' t=' + ev.time.toFixed(3) + 's\\n' + extra;
          });
          tooltip.textContent = lines.join('\\n');
          tooltip.style.display = 'block';
          tooltip.style.left = (e.clientX + 12) + 'px';
          tooltip.style.top = (e.clientY - 20) + 'px';
          return;
        }
      }
      tooltip.style.display = 'none';
    });
    canvas.addEventListener('mouseleave', function() { tooltip.style.display = 'none'; });

    slider.addEventListener('input', function() {
      frameIdx = parseInt(slider.value, 10);
      render();
    });

    btnPlay.addEventListener('click', function() {
      playing = !playing;
      btnPlay.textContent = playing ? '⏸' : '▶';
      if (playing) lastRenderTime = performance.now();
    });

    function animate(ts) {
      if (playing) {
        var elapsed = ts - lastRenderTime;
        lastRenderTime = ts;
        accumMs += elapsed * currentSpeed;
        while (accumMs >= frameMs) {
          accumMs -= frameMs;
          frameIdx++;
          if (frameIdx >= frames.length) {
            frameIdx = frames.length - 1;
            playing = false;
            btnPlay.textContent = '▶';
          }
        }
        render();
      }
      requestAnimationFrame(animate);
    }

    render();
    requestAnimationFrame(animate);
  };
})();
`;

function generateHtmlReport(allResults, timestamp) {
  const passed = allResults.filter(r => r.result.passed).length;
  const failed = allResults.filter(r => !r.result.passed).length;

  // Generate per-scenario sections with replay canvas
  const sections = allResults.map((r, idx) => {
    const status = r.result.passed ? 'pass' : 'fail';
    const screenshotCell = r.screenshotPath
      ? `<a href="${r.screenshotPath}" target="_blank">screenshot</a>` : '—';
    const stepList = r.result.stepResults.map(s => {
      const st = s.assertionPassed === null ? '○' : s.assertionPassed ? '✓' : '✗';
      return `<li class="${s.assertionPassed === false ? 'fail' : ''}">${st} [${s.frame}] ${s.label}${s.assertionError ? ' — ' + s.assertionError : ''}</li>`;
    }).join('');

    const containerId = `replay_${idx}`;
    const recordingJson = r.recording ? JSON.stringify(r.recording) : 'null';
    // Limit replay data size — truncate frames if >1500 to keep HTML manageable
    let safeRecordingJson = recordingJson;
    if (r.recording && r.recording.frames && r.recording.frames.length > 1500) {
      const trimmed = { ...r.recording, frames: r.recording.frames.slice(-1500) };
      safeRecordingJson = JSON.stringify(trimmed);
    }

    const replaySectionHtml = `
      <div class="replay-section">
        <div class="replay-title">Replay: ${r.scenario.name} @ ${r.surface}
          ${r.recording ? `<span class="replay-info">(${r.recording.frames.length} frames, ${(r.recording.summary.duration || 0).toFixed(1)}s)</span>` : ''}
        </div>
        <div id="${containerId}" class="replay-container"></div>
        <script>
          (function() {
            var rec = ${safeRecordingJson};
            createReplayPlayer('${containerId}', rec);
          })();
        </script>
      </div>`;

    return `
      <section class="scenario ${status}">
        <h2>${r.scenario.name} — ${r.surface} — <span class="${status}">${r.result.passed ? 'PASS' : 'FAIL'}</span></h2>
        <div class="scenario-meta">
          <span>${r.result.summary}</span>
          <span>${screenshotCell}</span>
        </div>
        <ul class="steps">${stepList}</ul>
        ${replaySectionHtml}
      </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Scenario Runner Report — ${timestamp}</title>
<style>
  body { font-family: monospace; background: #0d0d16; color: #ccc; padding: 20px; margin: 0; }
  h1 { color: #fff; margin: 0 0 4px; }
  h2 { color: #ddd; font-size: 1em; margin: 0 0 6px; }
  .summary { margin: 10px 0 20px; font-size: 1.1em; }
  .pass { color: #4f4; } .fail { color: #f44; }
  section.scenario { border: 1px solid #222; margin: 12px 0; padding: 12px; border-radius: 4px; }
  section.scenario.pass { border-color: #1a3a1a; background: #080e08; }
  section.scenario.fail { border-color: #3a1a1a; background: #0e0808; }
  .scenario-meta { display:flex; gap: 20px; color: #888; font-size: 0.9em; margin: 4px 0 8px; }
  .steps { margin: 0 0 10px; padding-left: 18px; font-size: 0.9em; }
  .steps li.fail { color: #f88; }
  .replay-section { margin-top: 8px; }
  .replay-title { color: #888; font-size: 0.85em; margin-bottom: 2px; }
  .replay-info { color: #555; margin-left: 8px; }
  .replay-container { display: inline-block; }
  a { color: #68f; }
</style>
</head><body>
<h1>Scenario Runner Report</h1>
<p style="color:#555">${timestamp}</p>
<div class="summary">
  <span class="pass">✓ ${passed} passed</span> &nbsp;
  <span class="fail">✗ ${failed} failed</span> &nbsp;
  / ${allResults.length} total
</div>
<script>${REPLAY_RENDERER_JS}</script>
${sections}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const allScenarios = loadScenarios();

  if (listOnly) {
    for (const sc of allScenarios) console.log(`  ${sc.name}: ${sc.description}`);
    return;
  }

  const scenarios = allScenarios.filter(sc => !filterScenario || sc.name === filterScenario);
  const surfaces = filterSurface ? [filterSurface] : ['sphere'];

  if (scenarios.length === 0) {
    console.error('[scenario-runner] No scenarios found. Check tests/visual/scenarios/*.json');
    process.exit(1);
  }

  console.log(`[scenario-runner] Running ${scenarios.length} scenario(s) on ${surfaces.length} surface(s)`);

  const browser = await launchBrowser();
  const allResults = [];

  try {
    for (const surface of surfaces) {
      console.log(`\n[scenario-runner] Surface: ${surface}`);
      const surfaceResults = await runScenariosOnSurface(browser, scenarios, surface);
      allResults.push(...surfaceResults);
    }
  } finally {
    await browser.close();
  }

  // Summary
  const passed = allResults.filter(r => r.result.passed).length;
  const failed = allResults.length - passed;
  console.log(`\n[scenario-runner] Done: ${passed} passed, ${failed} failed`);

  // HTML report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportHtml = generateHtmlReport(allResults, new Date().toISOString());
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = resolve(REPORT_DIR, `scenario-runner-${timestamp}.html`);
  writeFileSync(reportPath, reportHtml, 'utf-8');
  console.log(`[scenario-runner] Report: ${reportPath}`);

  // Results JSON (without recording data — that's in the HTML report)
  const resultsPath = resolve(REPORT_DIR, `scenario-runner-latest.json`);
  writeFileSync(resultsPath, JSON.stringify(allResults.map(r => ({
    scenario: r.scenario.name, surface: r.surface,
    passed: r.result.passed, summary: r.result.summary,
    recordingFrames: r.recording?.frames?.length ?? 0,
    recordingEvents: r.recording?.events?.length ?? 0,
  })), null, 2), 'utf-8');

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
