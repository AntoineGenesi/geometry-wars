# Visual Test: main-gameplay

**Timestamp:** 2026-02-11T15:50:26.620Z
**Commit:** a722f6a
**Script:** tests/visual/test-main-gameplay.mjs
**Renderer:** WebGL2 via SwiftShader (headless)
**Goal:** Verify Main.ts Refactor, Performance, and Difficulty & Gameplay items from HUMAN_TEST.md

## Console Errors (9 total, first 15)

- THREE.WebGLRenderer: A WebGL context could not be created. Reason:  Could not create a WebGL context, VENDOR = 0x1414, DEVICE = 0x008e, Sandboxed = no, Optimus = no, AMD switchable = no, Reset notific
- THREE.WebGLRenderer: A WebGL context could not be created. Reason:  Could not create a WebGL context, VENDOR = 0x1414, DEVICE = 0x008e, Sandboxed = no, Optimus = no, AMD switchable = no, Reset notific
- THREE.WebGLRenderer: Error creating WebGL context.
- Error creating WebGL context.
- Failed to load resource: the server responded with a status of 404 (Not Found)
- THREE.WebGLRenderer: A WebGL context could not be created. Reason:  Could not create a WebGL context, VENDOR = 0x1414, DEVICE = 0x008e, Sandboxed = no, Optimus = no, AMD switchable = no, Reset notific
- THREE.WebGLRenderer: A WebGL context could not be created. Reason:  Could not create a WebGL context, VENDOR = 0x1414, DEVICE = 0x008e, Sandboxed = no, Optimus = no, AMD switchable = no, Reset notific
- THREE.WebGLRenderer: Error creating WebGL context.
- Error creating WebGL context.

## Attempt 1: Sphere Surface (Main Gameplay)

**Screenshots:**
- 01-start-menu.png
- 02-mode-surface-select.png
- 03-game-started.png
- 04-moving-w.png
- 05-moving-a.png
- 06-moving-s.png
- 07-moving-d.png
- 08-shooting-right.png
- 09-shooting-left.png
- 10-mid-gameplay.png
- 11-zoomed-in.png
- 12-zoomed-out.png
- 13-later-gameplay.png
- 14-debug-overlay.png
- 15-gameplay-with-debug.png
- 16-pause-menu.png
- 17-performance-tab.png
- 18-resumed.png
- 19-after-bomb.png
- 20-difficulty-later.png

**Visual Analysis:**
> Claude must fill this in after reading each screenshot.

## Attempt 2: Cube-Tunnel Surface (Speed Normalization)

**Screenshots:**
- 01-start-menu.png
- 02-surface-selected.png
- 03-game-started.png
- 04-moving-forward.png
- 05-moving-right.png
- 06-mid-gameplay.png
- 07-debug-overlay.png
- 08-later-gameplay.png
- 09-pause-menu.png

**Visual Analysis:**
> Claude must fill this in after reading each screenshot.

## HUMAN_TEST.md Item Verdicts

### Main.ts Refactor
- [ ] Player movement (WASD all directions): PENDING
- [ ] Shooting (click to fire, bullets hit enemies, enemies die): PENDING
- [ ] Pickups spawn after kills: PENDING
- [ ] Pickup collection (walk over pickups): PENDING
- [ ] Camera controls (scroll zoom): PENDING
- [ ] Screen flash on death: PENDING
- [ ] UI updates (score, multiplier, lives, bombs): PENDING
- [ ] Pause menu (ESC opens, shows stats, resume): PENDING

### Performance
- [ ] FPS counter visible (debug overlay F3): PENDING
- [ ] Performance graphs (pause -> performance tab): PENDING

### Difficulty & Gameplay
- [ ] Gets harder over waves (enemy count increases): PENDING
- [ ] Enemy speed visible: PENDING
- [ ] Cube-tunnel speed normalization: PENDING

## Conclusion

> Overall assessment pending visual analysis.
