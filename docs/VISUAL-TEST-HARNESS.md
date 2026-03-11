# SP Visual Test Harness

Puppeteer-based automated testing for single-player Geometry Wars. Runs the **real game** (`src/main.ts` -> `GameLoop.ts`) in headless Chrome with SwiftShader WebGL, reads live telemetry via `window.__GAME_TELEMETRY`, and verifies gameplay correctness.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Puppeteer (Node.js)                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ verify-fix   │  │ scenario-    │  │ run-visual-   │  │
│  │   .mjs       │  │ tests.mjs    │  │ tests.mjs     │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                  │          │
│         └────────┬────────┴──────────────────┘          │
│                  │ page.evaluate(() =>                   │
│                  │   window.__GAME_TELEMETRY)            │
│                  ▼                                      │
│  ┌──────────────────────────────────────────────┐       │
│  │  Headless Chrome (SwiftShader WebGL)          │       │
│  │  localhost:3000?quickStart=true&surface=X     │       │
│  │  &debug=true                                  │       │
│  │                                               │       │
│  │  src/main.ts                                  │       │
│  │    └─> GameLoop.ts                            │       │
│  │         └─> GameTelemetryExporter.ts           │       │
│  │              └─> window.__GAME_TELEMETRY       │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### How it works

1. **Game startup**: URL params `?quickStart=true&surface=X&debug=true` bypass StartMenu, start gameplay immediately on the chosen surface, and activate telemetry.
2. **Telemetry**: `GameTelemetryExporter` (lazy-loaded when `?debug=true`) runs every fixed-update tick in `GameLoop.ts`. It writes a full game state snapshot to `window.__GAME_TELEMETRY`.
3. **Checks/Scenarios**: Puppeteer reads telemetry via `page.evaluate()`, simulates keyboard/mouse input, takes screenshots, and asserts game behavior.
4. **Canvas pixel reading**: A `requestAnimationFrame` hook copies the canvas to a temporary 2D canvas for pixel sampling (works around `preserveDrawingBuffer: false`).

### Key files

| File | Purpose |
|------|---------|
| `tests/visual/verify-fix.mjs` | Quick verification checks (one-liner for workers) |
| `tests/visual/scenario-tests.mjs` | Deep scenario tests (12 scenarios x 9 surfaces) |
| `tests/visual/run-visual-tests.mjs` | Full visual test suite (Suites 1-14) |
| `src/debug/GameTelemetryExporter.ts` | In-game telemetry exporter |
| `src/main.ts` | Wiring: quickStart params + telemetry activation |

---

## Quick Start

**Prerequisite**: Dev server must be running on port 3000.

```bash
# Start dev server (in a separate terminal or background)
npm run dev

# Verify it's up
curl -s http://localhost:3000 | head -1
```

### One-liner: Basic checks on one surface

```bash
node tests/visual/verify-fix.mjs --surface=torus --checks=no_crash,player_alive,enemies_visible --duration=15
```

### One-liner: All scenarios on one surface

```bash
node tests/visual/scenario-tests.mjs --surface=sphere
```

### One-liner: Single scenario on one surface

```bash
node tests/visual/scenario-tests.mjs --surface=torus --scenario=death
```

### One-liner: All scenarios on all 9 surfaces

```bash
node tests/visual/scenario-tests.mjs
```

### Full visual test suite (Suites 1-14 including regressions)

```bash
npm run test:visual
```

### Programmatic usage (from worker code)

```javascript
import { verifyFix } from './tests/visual/verify-fix.mjs';

const result = await verifyFix({
  surface: 'torus',
  mode: 'sp',
  duration: 20,
  checks: ['enemies_visible', 'player_alive', 'movement_works'],
});
// result.passed        — boolean
// result.screenshots   — string[] (file paths)
// result.failedChecks  — string[] (failure reasons)
// result.results       — { [checkName]: { passed, reason } }
```

---

## Available Checks (verify-fix.mjs)

Each check is a function that runs after the game has been playing for `--duration` seconds. Exit code 0 = all pass, 1 = any fail.

| Check | What it tests | PASS means | FAIL means |
|-------|--------------|------------|------------|
| `no_crash` | No critical JS errors during gameplay | Zero errors (ignores AudioContext, favicon, SharedArrayBuffer) | Runtime error in game code |
| `player_alive` | HUD lives display > 0 | Player survived through the test duration | Player died (possibly to invisible enemies or spawn bug) |
| `enemies_visible` | Enemies exist on screen | Debug overlay shows >=3 entities OR >=2 enemy-colored pixel samples | No enemies spawned or enemies invisible |
| `movement_works` | Pressing W causes screen change | >0.5% of pixels changed between before/after screenshots | Player is stuck or input not working |
| `enemy_dimming` | Far-side enemies are dimmer than near-side | Center brightness >= 90% of edge brightness | Edges are brighter than center (dimming inverted) |
| `score_increasing` | Shooting enemies increases score | Score > 0 after 3s of shooting | Score stuck at 0 (bullets not killing enemies) |
| `hit_detection_sane` | Enemies in collision radius cause death | Enemy-in-radius <60% of samples while player alive | Enemy sat inside player for >60% of samples without killing (hit detection broken) |
| `enemy_distances` | Enemies spawn at reasonable distances | <=3 enemies within 0.005 UV of player | >3 enemies at UV ~0 (spawned on top of player) |
| `collision_radii` | All collision radii are valid numbers | Player radius 0-5, all enemy radii 0-5 | Zero, negative, or >5 radius (NaN/broken config) |
| `enemy_spread` | Enemies are distributed across surface | UV variance > 0.001 | All enemies clumped at same position |

### Default checks (when `--checks` not specified)

CLI: `no_crash`, `player_alive`, `enemies_visible`, `movement_works`
API: `no_crash`, `player_alive`, `enemies_visible`

---

## Available Scenarios (scenario-tests.mjs)

Scenarios are deeper gameplay tests that run telemetry sampling over longer durations. Each scenario produces multiple sub-checks.

### Scenarios 1-6 (Core)

| # | Name | Duration | What it tests | What it catches |
|---|------|----------|---------------|-----------------|
| 1 | `death` | 15s | Death autopsy — frame-level analysis of every death | Spawn kills (death <2s at <0.05 UV), phantom kills (death with nearest enemy >0.3 UV + >3.0 world), surface/world distance mismatches |
| 2 | `movement` | ~10s | WASD coordinate change verification | Frozen player (world dist <0.01), NaN coordinates, teleporting (unreasonable distance), per-axis movement verification |
| 3 | `dimming` | 16s | Per-enemy opacity from `EnemyInstanceManager` | All enemies invisible (opacity ~0), non-standard opacity values (shader bug), binary dimming validation (1.0 near / 0.3 far) |
| 4 | `collision` | 5s | Entity radii + sustained overlaps | Invalid collision radii, sustained enemy-in-player-radius >1s without death (hit detection disabled) |
| 5 | `spawn` | 15s | Enemy UV distribution at 5s and 10s | Clumped spawns (UV variance <0.001), enemies spawning on player, lopsided quadrant distribution |
| 6 | `pixelation` | N/A | Renderer pixel analysis | Color reduction comparison between normal and pixelated modes (requires `__debugAPI.setPixelated`) |

### Scenarios 7-12 (Brutal Stress Tests)

These are harsh. Longer durations, strict thresholds, zero tolerance for phantom kills.

| # | Name | Duration | What it tests | What it catches |
|---|------|----------|---------------|-----------------|
| 7 | `survival` | 60s | Extended active gameplay (WASD + shooting) | Phantom deaths, spawn kills, NaN coordinates, game freeze (frame advancement <100), zero score |
| 8 | `approach` | 3x 20s | Walk INTO nearest enemy, verify death distance | Death too far from enemy (phantom kill), approach tracking with UV-aware direction |
| 9 | `seam` | 2x 15s | Move to UV boundaries on U and V axes | NaN at seam, discontinuous UV jumps, phantom deaths during seam crossing, enemy distance mismatches at seam |
| 10 | `pileup` | 30s | Let 30+ enemies accumulate without shooting | Frozen enemies (same UV for 5+ seconds), overlapping enemies (<0.005 UV), enemies not approaching player |
| 11 | `shooting` | 30s | Continuous shooting with aim sweeping | Zero kills (bullets not hitting), no bullets on screen, low kill rate (<1 per 10s), kills clustered in time |
| 12 | `distance_consistency` | 30s | Surface dist vs world dist for every enemy every sample | Surface-far + world-close mismatch (>0.3 UV but <2.0 world), surface-close + world-far (<0.05 UV but >5.0 world) |

### Supported surfaces (9 total)

`sphere`, `torus`, `cube`, `cube-ring`, `pill`, `peanut`, `mobius`, `sphere-tunnel`, `cube-tunnel`

---

## Telemetry Schema

`window.__GAME_TELEMETRY` is updated every fixed-update tick when `?debug=true` is set. Full schema:

```typescript
interface GameTelemetry {
  player: {
    u: number;                    // Surface U coordinate [0, 1]
    v: number;                    // Surface V coordinate [0, 1]
    worldPos: { x: number; y: number; z: number };  // 3D world position
    lives: number;                // Remaining lives
    score: number;                // Current score
    alive: boolean;               // Is player currently alive
    collisionRadius: number;      // Player collision radius (mesh.scale.x * 0.1)
  };

  enemies: Array<{
    type: string;                 // Enemy type name (e.g. "Wanderer", "Spinner")
    u: number;                    // Enemy surface U coordinate
    v: number;                    // Enemy surface V coordinate
    worldPos: { x: number; y: number; z: number };
    surfaceDistToPlayer: number;  // UV-based distance (wrapping-aware)
    worldDistToPlayer: number;    // Euclidean 3D distance
    collisionRadius: number;      // Enemy collision radius
    isAlive: boolean;             // Enemy alive state
    opacity: number;              // Per-instance opacity from EnemyInstanceManager (1.0=near, 0.3=far, 0.0=hidden)
  }>;

  bullets: Array<{               // Capped at 50 entries
    u: number;                    // Bullet surface U
    v: number;                    // Bullet surface V
    worldPos: { x: number; y: number; z: number };
  }>;

  pickups: Array<{
    type: string;                 // "weapon" or "buff"
    u: number;
    v: number;
    worldPos: { x: number; y: number; z: number };
    distToPlayer: number;         // Euclidean distance to player
  }>;

  surface: {
    type: string;                 // Surface type name from SurfaceType enum
  };

  collisions: {
    enemiesInPlayerRadius: number;      // Count of enemies currently within collision radius
    bulletsHittingEnemies: number;      // Count of bullet-enemy overlaps this frame
    nearestEnemyDist: number;           // Nearest enemy world distance (-1 if no enemies)
    nearestEnemySurfaceDist: number;    // Nearest enemy surface distance (-1 if no enemies)
  };

  frame: number;                  // Frame counter (increments each fixed-update)
  time: number;                   // Game clock total time (seconds)
  fps: number;                    // Fixed-update FPS (1 / fixedDeltaTime)
  isPaused: boolean;
  isGameOver: boolean;

  deaths: {
    total: number;                // Total death count this session
    log: Array<{                  // Full death log with autopsy data
      frame: number;              // Frame of death
      time: number;               // Game time of death
      playerU: number;            // Player UV at death
      playerV: number;
      playerWorldPos: { x: number; y: number; z: number };
      nearestEnemyDist: number;          // World distance to nearest enemy at death (-1 if none)
      nearestEnemySurfaceDist: number;   // Surface distance to nearest enemy at death (-1 if none)
      nearestEnemyType: string;          // Type of nearest enemy at death
      livesRemaining: number;            // Lives after this death
    }>;
    lastDeath: DeathLogEntry | null;     // Most recent death (or null)
  };
}
```

### Telemetry wiring in main.ts

```typescript
// src/main.ts line ~2103
if (debugMode) {
  import('./debug/GameTelemetryExporter').then(({ GameTelemetryExporter }) => {
    _telemetryExporter = new GameTelemetryExporter(ctx);
  });
}

// src/main.ts line ~1914 (inside onFixedUpdate)
if (_telemetryExporter) _telemetryExporter.update();
```

Telemetry is zero-overhead when `?debug=true` is not set (dynamic import, never loaded).

---

## How to Add a New Check

1. Add a function to `CHECK_REGISTRY` in `tests/visual/verify-fix.mjs`:

```javascript
async my_new_check(page, _opts) {
  // Read telemetry
  const t = await page.evaluate(() => window.__GAME_TELEMETRY);
  if (!t) return { passed: false, reason: 'No telemetry data' };

  // Your assertion logic
  if (t.player.score > 100) {
    return { passed: true, reason: `Score ${t.player.score} exceeds threshold` };
  }
  return { passed: false, reason: `Score ${t.player.score} too low` };
},
```

2. Use it: `node tests/visual/verify-fix.mjs --surface=sphere --checks=my_new_check`

## How to Add a New Scenario

1. Add an async function to `SCENARIOS` in `tests/visual/scenario-tests.mjs`:

```javascript
async my_scenario(page, surface) {
  const results = { name: 'My Scenario', surface, checks: [] };

  // Your test logic using telemetry, keyboard input, etc.
  const samples = await sampleTelemetry(page, 30, 10000);

  results.checks.push({
    check: 'my_condition',
    passed: samples.length > 10,
    detail: `Got ${samples.length} samples`
  });

  return results;
},
```

2. Run it: `node tests/visual/scenario-tests.mjs --scenario=my_scenario --surface=sphere`

---

## Known Limitations

### SP only
This harness tests `src/main.ts` -> `GameLoop.ts`. For multiplayer testing, use the MP harness: `node tests/mp/mp-test-harness.mjs --surface sphere`.

### SwiftShader rendering
Headless Chrome uses SwiftShader (software WebGL). Colors and brightness differ from real GPU rendering. The harness uses relaxed color thresholds to compensate, but pixel-level assertions should account for this.

### No canvas pixel readback by default
The game runs with `preserveDrawingBuffer: false`. Direct `canvas.getContext('webgl').readPixels()` returns zeros. The harness works around this by hooking `requestAnimationFrame` and copying the canvas to a 2D canvas immediately after each frame renders.

### Known surface bugs
Some surfaces have known issues that cause scenario failures:
- **cube-ring**: Enemies may appear frozen (movement in wrong direction — s44r10-03 fix applied but may not cover all edge cases)
- **mobius**: Non-orientable topology causes UV wrapping edge cases in seam-crossing tests

### vitest cannot run in git worktrees
The `real-game-verification.test.ts` vitest tests must run from the main project directory, not from a worktree. Orchestrator workers in worktrees should use `verify-fix.mjs` (Puppeteer) instead.

### Screenshot output
All screenshots are saved to `test-screenshots/` (verify-fix) or `test-screenshots/scenarios/` (scenario-tests). These directories are created automatically.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_PATH` | `~/.cache/puppeteer/chrome/.../chrome` | Path to Chrome binary |
| `PUPPETEER_EXECUTABLE_PATH` | (same as above) | Alternative Chrome path variable |
| `BASE_URL` | `http://localhost:3000` | Dev server URL |

### Viewport
Tests run at 640x360 resolution. This is intentionally small for performance in headless mode.

### Timing
The game needs ~3-4 seconds after navigation for the countdown to finish and gameplay to begin. All test tools account for this internally.
