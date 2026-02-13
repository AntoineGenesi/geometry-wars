# Player Movement Investigation Log

> This file persists ALL technical findings across fix iterations.
> Each worker MUST read this before starting and MUST append findings before finishing.
> Goal: avoid repeating failed approaches, accumulate real understanding.

## Problem Statement

Player movement is broken in the browser:
- Forward/backward movement is jerky
- Can only turn left, D key doesn't turn right
- Shooting doesn't go in aimed direction
- Enemy movement also glitchy (related?)

## Iteration 1 (commit 264471e) — NaN Crash Guard

**What was tried:** Added zero-length guards in `MeshWalker._updateTangentFrame()` to prevent NaN when transported tangent becomes parallel to normal.

**What it fixed:** Prevented NaN crash after ~30 seconds of movement.

**What it DIDN'T fix:** All directional control problems remain. Forward is jerky, turning broken.

**Key insight:** NaN was a symptom, not the cause. The tangent frame degeneracy happens because the movement direction itself is wrong.

## Iteration 2 (commit 2902314/5fd7a81) — Camera-Relative Input

**What was tried:** Rewrote `moveFromInput()` and `getAimDirection()` to project camera axes onto the surface tangent plane instead of using raw tangent/bitangent. Updated `GameLoop.ts` and `PlaygroundGame.ts` to use the new camera-relative methods.

**Unit test results:** 35 new tests pass (8 camera-relative + 27 surface trouble zones).

**User test result:** STILL BROKEN. Forward is jerky, can only turn left, aim is wrong.

**Key insight:** Unit tests used programmatic API (`walker.moveFromInput(1, 0, camera, dt)`) — they bypassed the real keyboard input pipeline. The bug is in the INTEGRATION between:
1. Keyboard events → InputManager
2. InputManager → GameLoop
3. GameLoop → MeshWalker.moveFromInput()
4. Camera following logic
5. Frame timing / update order

**Specific observations from user:**
- "forward" causes jitter and the player stays in place
- Pressing forward ONCE does a weird 90-degree turn
- Pressing again does 270 or 180 degree turn
- Can move in "square fashion" only
- D key only turns left, never right

**Possible root causes NOT yet investigated:**
1. Input sign/axis inversion — is W mapped to the wrong axis? Is D negated?
2. Camera update timing — does camera update BEFORE or AFTER movement? If before, the camera-relative projection uses stale camera data
3. InputManager polling frequency — are key states sampled correctly?
4. Player orientation update interfering with movement direction
5. Multiple conflicting movement calls per frame
6. CameraController orbit interfering with input mapping

## Iteration 3 (IN PROGRESS) — Deep Pipeline Investigation

**Approach:** Opus worker doing full pipeline trace from keyboard → screen. Created Puppeteer diagnostic tests and vitest integration tests.

**Findings from iteration 3 worker (commit b2a26ec):**
- Created `src/test/movement-integration.test.ts` — 17 integration tests simulating full game loop
- Created 6 Puppeteer diagnostic scripts in `tests/visual/s15-*.mjs`

### CRITICAL FINDING: All 17 integration tests PASS

The movement math is CORRECT when called through the simulated game loop:
- D key → screen-right ✓ (positive screenRightComponent)
- A key → screen-left ✓ (negative screenRightComponent)
- W key → screen-up ✓ (positive screenUpComponent)
- S key → screen-down ✓ (negative screenUpComponent)
- D/A symmetric ✓
- W/S symmetric ✓
- D and W perpendicular ✓
- Continuous movement stability (no jitter) ✓
- Camera convergence period ✓
- Multiple surfaces (sphere, torus, capsule) ✓
- Aim direction matches movement ✓

### WHAT THIS MEANS

The `MeshWalker.moveFromInput()` and `getAimDirection()` functions are correct. The camera-relative projection works. The issue is NOT in the movement math.

**The bug MUST be in one of these:**
1. **InputManager not providing correct values** — keyboard events → InputManager.getMovement() may return wrong values
2. **GameLoop calling moveFromInput with wrong arguments** — the real GameLoop.ts may transform the input differently than the test simulates
3. **CameraController behaving differently** — real CameraController.update() may differ from the simplified test simulation (test uses simple lerp + lookAt, real may have orbit, follow offset, smoothing, etc.)
4. **Game state blocking input** — game might be paused, in countdown, or in a state that suppresses movement
5. **PlaygroundGame.ts overriding movement** — PlaygroundGame has complex orientation/movement code with 6 REGRESSION GUARDS that may interfere
6. **Multiple code paths** — there may be ANOTHER movement code path that runs instead of or in addition to the camera-relative one

### WHAT HAS NOT BEEN TRIED YET
- Tracing the ACTUAL CameraController.update() vs the test simulation
- Checking if PlaygroundGame.orientPlayer() overrides movement
- Checking if there are TWO game loops running (e.g., PlaygroundGame + GameLoop both processing movement)

## Iteration 3b — Puppeteer Diagnostic Results

**Worker ran "MOVE-FROM-INPUT HOOK TEST" and found:**

### ROOT CAUSE IDENTIFIED (HIGH CONFIDENCE)

**Frame 0 of every key press has a massive displacement (3+ units instead of ~0.05) and is often REVERSED in direction.**

This strongly suggests a **huge dt value on the first frame after a key press**. The likely cause:
1. Game accumulates time while no input is happening
2. When a key is pressed, the first call to `moveFromInput(x, y, camera, dt)` gets a `dt` of several seconds worth of accumulated time
3. This causes a massive single-step displacement that overshoots and wraps around the surface, producing a "reversal"
4. Subsequent frames have normal dt (~0.016s) and work correctly

**This explains ALL user symptoms:**
- "Jerky forward movement" — the first frame leaps 3+ units, then normal frames are tiny → jitter
- "Only turns left" — the massive first-frame displacement wraps around and reverses direction, so D appears to go left
- "90/270 degree turns" — the overshoot wraps the player to a random position on the surface
- "Square-shaped movement" — after the overshoot snap, player is in a completely different orientation

**The fix should be:** Cap dt in the movement call. Something like:
```typescript
const clampedDt = Math.min(dt, 1/30); // Cap at ~33ms per frame
walker.moveFromInput(moveX, moveY, camera, clampedDt);
```

Or, fix the time accumulation logic in Game.ts / GameLoop.ts to not accumulate time while idle.

**Files to check:**
- `src/core/Game.ts` — look for time stepping, dt calculation, accumulated time
- `src/core/GameLoop.ts` — look for dt passed to moveFromInput()
- The game's `requestAnimationFrame` loop — where is dt computed?

## Key Code Locations

- `src/input/InputManager.ts` — Keyboard/gamepad input handling
- `src/core/GameLoop.ts` — Main update loop, calls moveFromInput
- `src/movement/MeshWalker.ts` — moveFromInput(), getAimDirection()
- `src/core/PlaygroundGame.ts` — orientPlayer(), has 6 REGRESSION GUARDS
- `src/camera/CameraController.ts` — Camera follow + orbit logic
- `src/core/Game.ts` — Entry point, wires everything together

## Iteration 4 (commit 1b02c12) — THREE ROOT CAUSES FOUND AND FIXED

**What was tried:** Three-part fix addressing the integration pipeline:

### Root Cause 1: LOCAL vs WORLD quaternion
`moveFromInput()` and `getAimDirection()` used `camera.quaternion` (local rotation) instead of `camera.getWorldQuaternion()` (world rotation). If the camera has parent transforms (which it does — the scene graph has groups with rotations), the local quaternion doesn't represent the actual world-space orientation. This caused camera right/up vectors to point in wrong directions.

**Fix:** Replace `camera.quaternion` with `camera.getWorldQuaternion(this._worldQuat)` in both `moveFromInput()` and `getAimDirection()`.

### Root Cause 2: Camera up/lookAt ordering
`CameraController.update()` called `lookAt()` BEFORE lerping `camera.up`. This meant `lookAt()` used stale up vector from the previous frame. On curved surfaces, the stale up caused the camera's right/up axes to lag by one frame, creating oscillating movement directions.

**Fix:** Reorder in CameraController: lerp `camera.up` BEFORE calling `lookAt()`.

### Root Cause 3: Camera alignment fallback to broken path
`moveFromInput()` had a `dot < -0.3` check that fell back to tangent-frame-direct movement whenever the camera wasn't looking "down enough" at the surface. This fallback is the pre-fix broken behavior. On many surfaces and camera angles, this threshold was exceeded, causing frequent fallback to the broken path.

**Fix:** Remove the dot-product alignment check entirely. Only fall back to tangent frame when the projected camera axes are truly degenerate (near-zero length after removing normal component).

### Verification Results
- **52/52 unit tests pass** (17 integration + 27 surface trouble zones + 8 camera-relative)
- **Puppeteer direction test: ALL 4 PASS** — D→RIGHT, A→LEFT, W→UP, S→DOWN
- **Puppeteer jitter test:** 100% correct direction in all 290 frames, 0 sign flips
- **Level 4 verification achieved** (programmatic visual)
- **User testing required** for Level 6 confirmation

### What this explains
- "D only turns left" → camera.quaternion (local) had different right vector than camera.getWorldQuaternion (world)
- "Forward is jerky" → stale camera.up in lookAt caused oscillating frame-to-frame right/up axes
- "90/270 degree turns" → camera alignment check triggered fallback to tangent-frame movement mid-play

## Iteration 5 — CAMERA LERP LAG FIX (upHint)

**Root cause identified: Camera.up lerp lag causes oscillating movement direction at 60 FPS.**

### The Problem
`moveFromInput()` used `camera.getWorldQuaternion()` to extract screen-space right/up vectors. The camera's `up` property is lerped toward the surface bitangent with factor 0.12 (CameraController) or 0.08 (PlaygroundGame). This creates a 1-frame lag in the camera's orientation.

On flat surfaces, this lag is invisible because the bitangent doesn't change. But on **curved surfaces** (sphere, torus, capsule), moving the player changes the surface normal and bitangent. The camera.up lags behind, causing:
- The extracted camera right/up vectors to oscillate frame-to-frame
- Movement direction to alternate between correct and slightly-off
- Visible as "jitter" and "going left-then-up instead of diagonal"

At 7 FPS (SwiftShader), ~8 fixed updates run per rendered frame, so the camera converges much faster relative to what's visible. At 60 FPS, only 1 update runs per frame, making the lag fully visible.

### The Fix: `upHint` parameter
Added an optional `upHint: THREE.Vector3` parameter to `moveFromInput()` and `getAimDirection()`. When provided, instead of extracting right/up from the camera's lerped world quaternion, the method:

1. Gets the camera's actual world position (minor lag, acceptable)
2. Uses the `upHint` vector as the ideal (pre-lerp) camera up
3. Computes camera right/up from a virtual lookAt(camPos, playerPos, upHint) — same Three.js convention
4. Projects these stable axes onto the surface tangent plane

The `upHint` is:
- **GameLoop.ts**: `CameraController.targetUp` — the camera's TARGET up (pre-lerp, includes orbit rotation)
- **PlaygroundGame.ts**: `walker.getTangentFrame().bitangent` — the ideal camera up for zero orbit

### Callers Updated
- `CameraController.ts`: Added `targetUp` field, saved before lerp in `update()`
- `GameLoop.ts`: Passes `ctx.cameraController.targetUp` to moveFromInput and getAimDirection
- `PlaygroundGame.ts`: Passes `frame.bitangent` to moveFromInput and getAimDirection

### Why This Fixes the Per-Surface Variation
- **Sphere jitter on lateral movement**: Camera.up oscillation between bitangent directions → eliminated by using exact bitangent
- **Pill partial movement**: Same camera.up lag → fixed
- **Cube spinning**: Cube uses MeshWalker in main game; tangent frame instability at edges is a separate issue, but stable camera axes help

### Verification
- 55/55 movement tests pass (11 camera-relative + 27 surface trouble zones + 17 integration)
- 3 new upHint-specific tests (path equivalence, 30-frame stability, aim direction)
- Puppeteer direction test: ALL 4 PASS (D=RIGHT, A=LEFT, W=UP, S=DOWN)
- Puppeteer jitter test: D 100% correct direction, 0% sign flips; W 100% correct direction, 1% sign flips
- TypeScript compiles clean (only pre-existing errors in test files)
- Level 4 verification achieved (programmatic visual)

## Rules for Future Iterations

1. READ THIS FILE FIRST
2. Do NOT re-try approaches that already failed
3. Write Puppeteer tests that simulate ACTUAL keypresses, not programmatic API
4. Tests must FAIL first (prove they detect the bug)
5. Track exact coordinates/angles when keys are pressed
6. Document ALL findings before returning — even "dead end" findings
7. If you can't fix it, document EXACTLY what you learned so the next iteration starts ahead
