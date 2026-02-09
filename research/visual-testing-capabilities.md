# Visual Testing Capabilities Research

## Date: 2026-02-10

## Executive Summary

Visual E2E testing is **fully achievable** on this WSL2 environment using Puppeteer + SwiftShader. A 29-test suite has been built and runs with 100% pass rate. The system can:

- Render full WebGL Three.js scenes headlessly via SwiftShader
- Capture screenshots that show all game elements (surfaces, players, enemies, UI, effects)
- Read pixel colors from the canvas (both via CDP screenshots and rAF injection)
- Simulate keyboard/mouse input and verify visual changes
- Test multiple surfaces, game states, and UI flows
- Run in ~5 minutes per full suite

## Environment Details

| Component | Version/Details |
|-----------|----------------|
| OS | WSL2 (Linux 5.10.16.3-microsoft-standard-WSL2) |
| Node | 20.19.5 via nvm |
| Chrome | 144.0.7559.96 (Puppeteer-managed) |
| WebGL Backend | SwiftShader (Vulkan 1.3.0, Subzero) |
| WebGL Version | WebGL 2.0 (OpenGL ES 3.0 Chromium) |
| GLSL Version | WebGL GLSL ES 3.00 |
| Max Texture | 8192x8192 |

## What Works

### 1. Full WebGL Rendering via SwiftShader

SwiftShader provides a complete software implementation of Vulkan/OpenGL that runs on CPU. On this WSL2 system, Chromium's SwiftShader backend successfully renders:

- Three.js scenes with custom shaders
- EffectComposer post-processing (bloom, glow)
- InstancedMesh rendering (enemies, bullets)
- Wireframe grid overlays
- Transparent/additive blending (particles, effects)
- Multiple viewports (split-screen)

**Launch flags required:**
```
--enable-webgl
--use-gl=swiftshader
--use-angle=swiftshader
--enable-unsafe-swiftshader
--no-sandbox
```

### 2. CDP Screenshot Capture (Primary Method)

Puppeteer's `page.screenshot()` uses Chrome DevTools Protocol to capture the composited page output. This captures WebGL canvas content **regardless of `preserveDrawingBuffer` setting**. This is the most reliable method.

**Capabilities:**
- Full 1280x720 PNG screenshots
- All game elements visible (canvas + DOM overlay)
- Can be compared byte-by-byte for regression testing
- ~100ms per capture

### 3. requestAnimationFrame Canvas Reading

By injecting a hook into `requestAnimationFrame`, we can read canvas pixels **during** the render loop (after draw, before buffer swap). This enables:

- Pixel grid sampling (40x40 = 1600 points)
- Color distribution analysis
- Center/specific coordinate pixel reads
- Non-black pixel counting

**Key finding:** Without `preserveDrawingBuffer`, direct canvas reads return black. But the rAF hook approach captures data during the frame, before the buffer clears.

### 4. `?testMode=true` URL Parameter

Added support for a `testMode` query parameter that enables `preserveDrawingBuffer: true` on the WebGL renderer. This allows direct canvas pixel reading at any time:

```
http://localhost:3000?testMode=true&surface=sphere
```

### 5. Input Simulation

Full keyboard and mouse input simulation works:
- WASD movement (verified via screenshot diff)
- Mouse click shooting (verified via screenshot diff)
- ESC pause/resume
- Space bomb
- M mute toggle
- F3 debug overlay

### 6. DOM Element Verification

Standard Puppeteer DOM queries work for verifying UI elements:
- Score display text content
- Multiplier display
- Lives/bombs indicators
- Level name
- Pause menu visibility
- Start menu buttons

## What Doesn't Work / Limitations

### 1. Playwright Browser Downloads Timeout

The Playwright `install chromium` command times out on this WSL2 network configuration:
```
Error: Request to https://cdn.playwright.dev/builds/cft/145.0.7632.6/linux64/chrome-linux64.zip timed out after 30000ms
```

**Workaround:** Use Puppeteer's Chrome binary (`~/.cache/puppeteer/chrome/`) which is already installed and fully functional.

### 2. SwiftShader Performance

SwiftShader renders at ~2-5 FPS on CPU. This means:
- Each game load takes ~5 seconds for initial render
- Extended gameplay tests need generous `sleep()` calls
- Full 29-test suite takes ~5 minutes
- Not suitable for real-time frame-by-frame analysis at 60fps

### 3. No GPU Acceleration

WSL2 doesn't expose the host GPU to headless Chrome by default. All rendering is CPU-based via SwiftShader. This means:
- Bloom/glow effects render but may look slightly different from GPU rendering
- Performance-sensitive visual tests (adaptive quality, LOD switching) may not trigger
- WebGPU is not available

### 4. Audio Context

Web Audio API does not work in headless mode (no audio device). Tests must filter out `AudioContext` errors. Audio-related features cannot be visually verified (no waveform analysis).

### 5. Two-Player LAN Testing

While we **can** open two browser instances simultaneously (verified), testing actual LAN multiplayer requires:
- Colyseus server running on port 2567
- Both instances connecting to the same room
- Coordinated timing between the two pages
- This is achievable but adds complexity

## Test Suite Architecture

### Current Suite: `tests/visual/run-visual-tests.mjs`

**10 test suites, 29 tests:**

| Suite | Tests | What It Verifies |
|-------|-------|------------------|
| Start Menu | 6 | Menu renders, title, buttons, surfaces, WebGL, screenshot |
| Game Loading | 5 | 3 surfaces load, canvas renders, UI elements |
| Player Movement | 3 | WASD no crash, visual change, direction |
| Shooting | 2 | Click no crash, visual change |
| Pause Menu | 2 | ESC opens, resume works |
| Extended Gameplay | 2 | 10s stability, enemies spawn |
| Surface Variety | 6 | sphere/cube/torus/pill/peanut/icosahedron |
| Bomb Usage | 1 | Space key |
| Audio Toggle | 1 | M key |
| Debug Overlay | 1 | F3 key |

### Existing Suite: `src/test/visual-integration.test.ts`

**408+ Vitest tests** (headless, no browser):
- Bullet origin/direction on 11 surfaces
- Bullet bevel traversal
- Camera following
- Enemy positioning
- Surface mesh quality
- Bevel continuity
- Depth-based opacity
- Collision geometry
- Player-surface sync
- Grid deformation
- Multi-bullet scenarios
- World-to-surface consistency

### Existing E2E: `tests/visual-e2e.spec.ts`

**Playwright-based tests** (currently not runnable due to browser download issues):
- Start menu, game loading, UI elements
- Keyboard/mouse input
- Surface screenshots
- Multiplayer mode

## Pixel-Level Verification Approach

### Method 1: CDP Screenshot Diff (Best for regression)

```javascript
// Take two screenshots and compare
const before = await page.screenshot({ encoding: 'binary' });
// ... perform action ...
const after = await page.screenshot({ encoding: 'binary' });
const diffPercent = screenshotDiffPercent(before, after);
expect(diffPercent).toBeGreaterThan(0.5); // Something changed
```

### Method 2: rAF Canvas Capture (Best for color analysis)

```javascript
await injectCanvasReader(page);
const frame = await captureFrameData(page);
// frame.nonBlack, frame.bright, frame.center, frame.colors
```

### Method 3: testMode Direct Read (Best for specific coordinates)

```javascript
await page.goto('http://localhost:3000?testMode=true&surface=sphere');
// ... start game ...
const pixel = await page.evaluate(({ x, y }) => {
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d'); // Works because preserveDrawingBuffer=true
  // ... read pixel ...
}, { x: 640, y: 360 });
```

## Verification Level Assessment

With this visual testing infrastructure, here is the realistic achievable verification per category:

| Category | Before | Now | Notes |
|----------|--------|-----|-------|
| UI changes | Level 1 (compiles) | Level 4 (E2E verified) | DOM + screenshot |
| Surface rendering | Level 1 | Level 4 | Screenshot + pixel analysis |
| Player movement | Level 2 (unit tests) | Level 4 | Screenshot diff |
| Shooting | Level 2 | Level 3.5 | Visual change verified, not projectile tracking |
| Enemy spawning | Level 2 | Level 4 | Frame capture color detection |
| Pause/resume | Level 1 | Level 4 | DOM + screenshot |
| Game stability | Level 1 | Level 4 | 10s gameplay without crash |
| Multiple surfaces | Level 2 | Level 4 | All surfaces screenshot verified |
| LAN multiplayer | Level 1 | Level 3 | Server boot + 2 instances possible |
| Specific entity colors | Level 0 | Level 3.5 | Color regions detected, not entity-level |

## Recommendations

### For CLAUDE.md Verification Level Updates

1. **Level 3.5 (Visual E2E)** should be added between Level 3 and Level 4:
   - Headless browser renders the game
   - Screenshots show expected content
   - Pixel analysis confirms colors/regions
   - Cannot verify "feel" or performance-sensitive behavior

2. **Level 4 should be reserved for** user-tested scenarios only

3. After making visual changes, agents should:
   - Run `npm run test:visual` (29 E2E tests)
   - Check test-screenshots/ for visual confirmation
   - State "Verification: Level 3.5 (visual E2E)" instead of Level 1

### For Future Enhancement

1. **Entity-specific testing**: Expose game state via `window.__testAPI = { game, player, enemies }` to allow tests to query exact entity positions and compare to rendered pixels
2. **Screenshot regression**: Store baseline screenshots and diff against them
3. **Multiplayer E2E**: Script two browser instances joining a Colyseus room
4. **CI integration**: Run visual tests in GitHub Actions with a Linux runner
5. **Performance profiling**: Use Chrome DevTools protocol performance tracing

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `tests/visual/run-visual-tests.mjs` | Created | 29-test visual E2E suite |
| `package.json` | Modified | Added `test:visual` script |
| `src/core/Game.ts` | Modified | `?testMode=true` preserveDrawingBuffer |
| `src/rendering/RendererFactory.ts` | Modified | `?testMode=true` preserveDrawingBuffer |
| `research/visual-testing-capabilities.md` | Created | This document |
