# Programmatic Test Harness (Browser-Based)

Real browser testing with Puppeteer + SwiftShader. Connects to the running game via the debug API for Level 5 verification.

## Quick Start

```bash
# Run smoke test
export PATH="/home/antoine/.nvm/versions/node/v20.19.5/bin:$PATH"
node tests/programmatic/smoke-test.mjs

# Run deep gameplay demo
node tests/programmatic/demo-deep-gameplay.mjs
```

## Features

### Core Capabilities
- Launches headless Chrome with SwiftShader (real WebGL rendering)
- Automatically starts/stops dev server (port 3000)
- Connects to game via debug API (`window.__gameDebug`)
- Takes screenshots organized by session

### State Queries
- `getEnemyStates()` — All enemies with position, health, type
- `getPlayerState()` — Player position, score, lives, velocity
- `getBulletStates()` — All active bullets
- `getGameState()` — Frame count, time, enemy/bullet counts
- `getCameraState()` — Camera position, rotation, FOV

### Game Control
- `sendInput(key, pressed)` — Simulate keyboard (W/A/S/D/Space/etc)
- `setMousePosition(x, y)` — Mouse aim
- `setMouseDown(down)` — Mouse fire
- `spawnEnemy(type, u, v)` — Spawn enemy at UV coords
- `setSeed(seed)` — Deterministic gameplay
- `pause() / resume()` — Pause control

### Deep Gameplay Support
- `waitFrames(n)` — Wait for N real game frames
- `fastForward(seconds)` — Let game run for N seconds
- `waitForWave(n)` — Play until wave N
- `waitForEnemyType(type)` — Play until enemy type spawns
- `getWaveInfo()` — Current wave, enemies, time
- `screenshotWhenEnemyAppears(type, filename)` — Auto-screenshot on spawn

## Example Usage

```javascript
import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const harness = new BrowserTestHarness({
  surface: 'sphere',
  seed: 42,
  headless: true
});

await harness.start();
await harness.startGame();

// Query state
const player = await harness.getPlayerState();
const enemies = await harness.getEnemyStates();
console.log(`Player at (${player.position.x}, ${player.position.y}), ${enemies.length} enemies`);

// Control game
await harness.sendInput('w', true);  // Press W
await harness.waitFrames(60);        // Move for 1 second
await harness.sendInput('w', false); // Release W

// Screenshot
await harness.screenshot('after-movement');

await harness.stop();
```

## Screenshot Organization

```
test-screenshots/programmatic/YYYY-MM-DD_HHMM_harness_SURFACE_SEED/
  01-initial-state.png
  02-after-spawn.png
  03-final.png
```

## QuickStart URL

The harness uses `?quickStart=true&surface=X&seed=Y&debug=true` to skip menus entirely.

## Verification Level

**Level 5:** Targeted Puppeteer screenshot + programmatic state verification. This is the maximum verification level Claude can achieve autonomously.

For LAN multiplayer, Level 5 is still the ceiling (user testing required for final verification).

## Architecture

- **BrowserTestHarness.mjs** — Main harness class
- **smoke-test.mjs** — Basic smoke test (8 steps)
- **demo-deep-gameplay.mjs** — Advanced demo (wave progression, enemy types, etc)

## Dependencies

- Puppeteer (already in devDependencies)
- Chrome at `/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome`
- Node 20.19.5 via nvm
- Dev server on port 3000 (auto-started if not running)

## Cleanup

The harness automatically:
- Closes browser on `stop()`
- Kills dev server (if it started it)
- Cleans up processes on exit

Always call `await harness.stop()` in a try/finally block to ensure cleanup.
