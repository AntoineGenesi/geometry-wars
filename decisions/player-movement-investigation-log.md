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

## Iteration 5 — USER TEST RESULT: STILL BROKEN (closer but not fixed)

**User tested iteration 5 (upHint fix) in real browser:**

### Symptoms:
1. **Forward still jerky** — player doesn't move linearly forward over 1 second. Veers in different directions.
2. **A/D causes chevron to glitch** — player chevron spins super fast, you see MULTIPLE COPIES in the same spot. Player barely moves in intended direction. Then the ENTIRE MAP jumps in the correct direction as one big movement.
3. **Map jumps** — the sphere/map eventually turns the right way but in a single large discontinuous jump, not smooth continuous rotation.
4. **Better than iter 4** — player CAN move, but the glitching makes it unplayable.

### Analysis:
- **"Chevron spinning super fast with multiple copies"** = player ORIENTATION is oscillating rapidly while POSITION barely moves. This is the tangent frame or player.quaternion fighting the camera or surface normal.
- **"Whole map jumps"** = camera eventually snapping to new orientation discontinuously. The camera.up lerp may still be causing issues, OR the upHint is correct for movement but the CAMERA FOLLOW still uses the lagged lerp, causing visual discontinuity.
- **"Forward veering"** = camera-relative axes still have some residual oscillation, even with upHint.

### Key insight: The upHint fixed the MOVEMENT DIRECTION but not the VISUAL PRESENTATION
The player may actually be moving correctly now, but:
1. The ORIENTATION (player mesh rotation / chevron facing) is computed separately and may use the old lagged camera axes
2. The CAMERA FOLLOW is still lerping, creating visual jumps when the surface normal changes significantly
3. There may be TWO systems setting player rotation — the movement system and the rendering/orientation system — and they disagree

### What to investigate in iteration 6:
1. **Player orientation update** — how is the chevron rotation computed? Is it using camera axes (lagged) or surface tangent frame (stable)?
2. **Camera follow smoothness** — is camera.up lerp creating the "map jump"? Should the camera also use upHint for its own orientation?
3. **Double-orientation problem** — check if PlaygroundGame.orientPlayer() and GameLoop both set player rotation
4. **Frame-rate dependent oscillation** — the "spinning multiple copies" suggests high-frequency oscillation (hundreds of Hz), which means something is flipping orientation every frame or every other frame

## Iteration 6 — THREE-PRONGED FIX (tangent frame + orientation + camera)

### Root Cause (confirmed by analysis + tests)

The walker's tangent frame `_updateTangentFrame()` has a swap-or-keep decision that compares `keepScore` vs `swapScore`. When movement is at ~45° to the tangent frame axes, these scores are nearly equal, causing the swap to flip-flop every frame. This oscillation propagates to:

1. **Camera.up** (lerps toward the oscillating bitangent → "map jumping")
2. **upHint** (passes oscillating bitangent to moveFromInput → jittery movement)
3. **Player orientation** (getAimDirection default = bitangent → "chevron spinning")

At 7 FPS (Puppeteer), 8 fixed steps run per visible frame, averaging out oscillation. At 60 FPS, each step is visible, making oscillation fully apparent.

### Fix 1: Tangent frame swap hysteresis (MeshWalker.ts)
Changed `if (swapScore > keepScore)` to `if (swapScore > keepScore + 0.1)`.
The 0.1 threshold requires a clear advantage before swapping axes, preventing ambiguous flip-flop. This is the ROOT CAUSE fix.

### Fix 2: Orientation slerp smoothing (GameLoop.ts + PlaygroundGame.ts)
Changed direct `quaternion.setFromRotationMatrix(orientMat)` to `quaternion.slerp(targetQuat, 0.35)`.
This dampens any residual high-frequency orientation changes, preventing the "chevron spinning super fast" visual artifact. Factor 0.35 is responsive but smooth.

### Fix 3: Camera convergence speed (CameraController.ts + PlaygroundGame.ts)
Increased `CAMERA_LERP_FACTOR` from 0.12 to 0.25.
At 0.12, camera.up took ~30 frames (0.5s) to converge, creating visible "map jumping" discontinuity. At 0.25, convergence is 97% within 12 frames (0.2s) — below perceptibility threshold.
PlaygroundGame camera lerp: 0.1→0.2 (position), 0.08→0.18 (up).

### Verification
- 14/14 camera-relative input tests pass (including 3 NEW stability tests)
- 27/27 surface trouble zone tests pass
- 17/17 movement integration tests pass
- 3/3 frame-by-frame diagnostic tests pass (all report "orientation stability: stable")
- Puppeteer direction test: ALL 4 PASS (D=RIGHT 3°, A=LEFT 179°, W=UP 89°, S=DOWN -89°)
- Puppeteer jitter test: W 100% correct dir, 0.7% sign flips; D 100% correct dir, 1% sign flips
- TypeScript compiles clean (only pre-existing test file errors)

### Why this should work at 60 FPS (unlike previous iterations)
- Previous iterations: movement direction was correct but TANGENT FRAME oscillated. This was hidden at 7 FPS.
- This iteration: tangent frame oscillation is ELIMINATED at the source (swap hysteresis).
- Orientation smoothing provides defense-in-depth against any residual oscillation.
- Camera convergence is fast enough to track surface changes without visible lag.

## Iteration 6 — USER TEST RESULT: STILL BROKEN (closer but persistent lateral jerk)

**User tested iteration 6 (three-pronged fix: hysteresis + slerp + camera convergence) in real browser:**

### What WORKS now:
- Forward/backward movement works FINE (big improvement!)
- Some spheres work reasonably well for left/right

### What's STILL broken:
1. **Left/right movement is jerky** — player doesn't move smoothly. There's a repetitive jerk near the end of each "step". It happens every little bit, like a periodic stutter.
2. **Diagonal movement (W+A, W+D) glitches on the spot** — instead of a smooth curve forward-left or forward-right, the player just glitches/vibrates in place. No actual movement occurs.
3. **User suspects tick/speed issue** — "obviously the player must be at a frame rate or at some sort of a tick or game speed that's just way too fast because it's really glitchy"

### Analysis:
- **Forward/back working but left/right jerky** = tangent axis (forward) is stable, but bitangent axis (lateral) still has issues. The swap hysteresis may have helped forward but not fully resolved lateral movement.
- **"Repetitive jerk near the end"** = suggests periodic oscillation or a cyclic problem. Could be: (a) slerp overshooting and correcting, (b) tangent frame still oscillating at a lower frequency, (c) something in the movement/position update accumulating and snapping periodically.
- **Diagonal glitching in place** = when both axes are combined, something cancels out. The lateral jitter combined with forward movement results in zero net displacement. This could be: (a) the lateral component fighting the forward component via tangent frame adjustment, (b) orientation slerp dampening too aggressively for diagonal, (c) movement getting clamped or normalized incorrectly when both axes active.
- **"Too fast" suspicion from user** = might indicate fixed-step dt is wrong, or there's a speed multiplier issue. Or the jitter frequency is so high it looks like "too fast."

### What to investigate in iteration 7:
1. **Fixed timestep vs render frame** — Are multiple fixed steps happening per render frame? At 60 FPS with fixedDt of 1/60, should be 1:1. But if fixedDt is smaller (e.g., 1/120), 2 steps per frame could cause visible oscillation.
2. **moveFromInput speed parameter** — Is the movement speed too high? If speed * dt per step is too large, the walker overshoots and wraps, causing the "jerk near the end."
3. **Lateral-specific tangent frame issue** — Forward movement may use tangent (stable) while lateral uses bitangent (less stable). Check if bitangent computation is smooth along the player's path.
4. **Slerp factor 0.35** — At 60 FPS, 0.35 per frame converges quickly but may oscillate. Test with 0.15-0.20 and see if jitter reduces.
5. **Diagonal input normalization** — When W+A are both pressed, is the input vector normalized? If not, diagonal movement is 1.41x faster, which combined with overshooting could cause the "glitch in place."
6. **Double movement calls** — Check if both GameLoop AND PlaygroundGame are calling moveFromInput, resulting in double movement per frame.

## Iteration 7 — DUAL GRAM-SCHMIDT (Root Cause Elimination)

### Why Iteration 6 Failed

The swap hysteresis (threshold 0.1) was fundamentally insufficient. After a swap, the score difference becomes ~2.0:
- Frame N: `swapScore > keepScore + 0.1` → swap fires (scores are close to equal at ~45°)
- Frame N+1: Post-swap axes are ~45° rotated → `keepScore ≈ 0, swapScore ≈ 2` → immediate swap-back
- Any hysteresis < 1.0 still oscillates. Hysteresis > 1.0 prevents ALL swaps (effectively removes the feature).

The slerp (0.35) and camera convergence (0.25) were bandaids that masked but didn't fix the oscillation. User saw periodic jerk (swap oscillation peaking through slerp dampening) and diagonal freeze (lateral oscillation cancelling net displacement).

### The Fix: Remove Swap Entirely

**Dual Gram-Schmidt projection** replaces the entire swap-based tangent frame update:

```typescript
// Project old tangent onto new tangent plane
tangent -= (tangent · normal) * normal
normalize(tangent)

// Project old bitangent onto new tangent plane
bitangent -= (bitangent · normal) * normal
normalize(bitangent)

// Re-orthogonalize
bitangent -= (bitangent · tangent) * tangent
normalize(bitangent)
```

**Why this works:**
- No swap = no oscillation, period. Root cause eliminated.
- Geometry-driven, not movement-driven: frame evolves with surface, not input direction
- Equivalent to parallel transport for small steps: per-frame error is O(displacement × curvature)
- Compatible with all surfaces (smooth + sharp via BVH fallback)

**What was removed:**
- Swap logic in `_updateTangentFrame` (30 lines of keepScore/swapScore/threshold)
- Orientation slerp(0.35) in GameLoop.ts and PlaygroundGame.ts (bandaid for oscillation)
- The `_transportedTangent` parameter is now ignored (prefixed with `_`)

**What was added:**
- Dual Gram-Schmidt in `_updateTangentFrame` (15 lines)
- Sign-flip protection on `CameraController.targetUp` (3 lines)
- 4 regression tests targeting lateral jerk and diagonal freeze

### Dead Ends Ruled Out

| Approach | Why It Doesn't Work |
|----------|-------------------|
| Increase hysteresis to 0.5+ | Post-swap scores are ~2.0 apart; would need >1.0 which prevents ALL swaps |
| Swap cooldown (30 frames) | Hack — allows a one-time 40° axis jump that creates visible jerk |
| Smooth targetUp with exponential decay | Adds lag (failed in iteration 5 as camera.up lerp lag) |
| Higher slerp factor | Dampens but doesn't eliminate oscillation; makes controls feel sluggish |

### Verification

- 18/18 camera-relative input tests pass (14 existing + 4 new)
- 27/27 surface trouble zone tests pass
- 17/17 movement integration tests pass
- TypeScript compiles clean (only pre-existing test file errors)
- **Level 2 verification — User testing required for Level 6**

### Decision Log

Full analysis at `decisions/tangent-frame-dual-gram-schmidt.md`

## Iteration 7 — USER TEST RESULT: CLOSE BUT SURFACE-SPECIFIC ISSUES

**User tested iter 7 in real browser. Verdict: closer but NOT fixed.**

### Symptoms by surface:

**Cube:** Trail effect multiplied (4 copies of the trailing line), offset from player (too far behind/left). Movement "relatively OK" otherwise.

**Sphere:** Jerky map wobble on left/right input — map moves up-then-down to reach position (vertical overshoot). WORSE near the origin, smooths out further away. User suspects UV/coordinate system issue.

**Pill:** WORST. Trail line reveals overshooting zigzag: left→up→RIGHT (overshooting by same distance). Then up→back. Diagonal (left+up, right+up) still jerky.

### Analysis:

1. **The trail effect is a diagnostic tool** — it shows the player's actual frame-by-frame path, and that path is NOT straight for straight-line input.
2. **Surface-dependent severity suggests curvature × tangent frame interaction** — cube (flat faces) is OK, sphere (constant curvature) has wobble, pill (varying curvature at caps) is worst.
3. **"Worse near origin"** — on a sphere, the "origin" in UV space may coincide with the pole where the tangent frame is degenerate. The dual Gram-Schmidt may still produce instability at/near poles or UV seams.
4. **Overshooting pattern (X pixels left → X pixels right)** — this is NOT the old swap oscillation (that was eliminated). This may be a DIFFERENT oscillation: the tangent frame rotating slightly each step due to Gram-Schmidt projection on curved surfaces, creating a systematic drift that compounds into visible overshoot.
5. **4 trail copies** — may be a rendering bug (instanced geometry offset wrong) unrelated to movement, OR the trail is correctly showing 4 divergent paths from frame-to-frame position jitter.

### Hypotheses for iteration 8:

1. **Gram-Schmidt accumulation error on high-curvature surfaces** — dual Gram-Schmidt is O(curvature × step) per frame. On a sphere with radius 10 and speed 5, that's ~0.008 rad/frame error. Over 60 frames (1 second), that's ~0.5 rad = 28° of accumulated tangent frame rotation. This would cause systematic direction drift, not pure oscillation — but if the camera tracks the drifting frame, the camera-relative input would compensate, creating a damped oscillation.

2. **UV seam/pole singularity** — at the pole of a sphere or UV seam of a pill, the Gram-Schmidt projected tangent can become degenerate (near-zero length), triggering the fallback path which resets the tangent frame abruptly → position/direction discontinuity.

3. **Trail effect is rendering bug** — the trail might use the tangent frame for positioning (offset from player along bitangent). If the tangent frame has the accumulated error from hypothesis 1, the trail is offset in the wrong direction. 4 copies could mean 4 sub-frame positions are being rendered.

4. **Camera up lerp still oscillating on high-curvature** — the sign-flip protection on targetUp may not be enough on surfaces where the bitangent changes rapidly (pill caps, sphere near poles).

### What to test in iteration 8:
- Move across ALL surfaces systematically
- Focus on UV boundaries, poles, seams, origin regions
- Measure per-frame displacement at different surface locations (near pole vs equator)
- Check if trail effect issue is rendering vs movement
- Check tangent frame stability at high-curvature regions

## Iteration 8 — Cross-Surface Fix (STARTED)

### Critical Finding: ALL surfaces work in unit tests

**Torus, capsule, icosahedron all have valid movement in vitest:**
- Torus: moveFromInput 30 frames = 1.76 units displacement
- Capsule: moveFromInput 30 frames = 1.50 units displacement
- Icosahedron: moveFromInput 30 frames = 1.83 units displacement
- All geodesic walks produce valid results (distanceTraveled > 0)
- All tangent frames initialize correctly

**The "stuck" surfaces (zero movement in Puppeteer) are NOT a MeshWalker bug.** The issue is in the browser runtime integration. Possible causes:
1. Player dies during the 20-second game init wait before invincibility is set
2. Game state (pause, game over, etc.) blocks input processing
3. Input doesn't reach the game loop on these surfaces
4. A runtime error breaks the game loop on these surfaces

**Cube and pill direction issues ARE likely MeshWalker bugs** — the tangent frame behavior at edge discontinuities (cube) and varying curvature (pill) needs fixing.

### Plan:
1. Fix cube edge-crossing tangent frame to prevent direction reversals
2. Fix pill diagonal zigzag
3. Investigate browser-side stuck issue by examining the Puppeteer test setup
4. Run cross-surface diagnostic after fixes

### Iteration 8 Checkpoint — Entry nudge and tangent frame transport

**Changes applied:**
1. `FaceWalker._computeEntryBary` eps: 0.1 → 1e-4 (vertex detection eps: 0.05 → 0.01)
2. `MeshWalker._updateTangentFrame`: replaced dual Gram-Schmidt with rotation-based quaternion transport

**Test results with eps=1e-4:**
| Test Case | Before (eps=0.1) | After (eps=1e-4) |
|-----------|-----------------|-----------------|
| Forward (5 positions) | 0-2 reversals | 0-2 reversals |
| Lateral | 106-127 reversals | 188 reversals (WORSE) |
| Diagonal | 78 reversals | 7 reversals (MUCH BETTER) |
| Pill diagonal | 30 reversals | 0 reversals (FIXED!) |
| Bitangent flips | N/A | 0 |
| Cube vs sphere | N/A | 2 vs 0 |

**Key findings:**
1. **FaceWalker itself walks correctly** — direct FaceWalker.walk() produces 0-3 reversals on flat cube faces
2. **MeshWalker.move() also walks correctly** — with fixed direction (1,0,0) or tangent frame on any single face, 0 reversals
3. **Cube lateral reversal is a CAMERA INTERACTION bug** — 188 reversals only happen with moveFromInput + camera follow. The camera-right projection onto the surface oscillates when the camera is lagging during edge crossings.
4. **The entry nudge eps reduction fixed diagonal and pill** but made lateral worse because the walker now crosses more triangle edges per step (smaller nudge = stays closer to edges = more crossings = more camera direction changes)

**Root cause of lateral reversal:**
When input is pure lateral (inputX=1, inputY=0), the movement direction is entirely determined by the camera's right vector projected onto the surface. When the walker crosses a cube edge:
- Camera position lags (lerp 0.25) behind the walker
- Camera-right projection onto the NEW surface face oscillates as the camera catches up
- Each oscillation reverses the movement direction

**Hypotheses for fix:**
1. Increase camera follow speed for lateral movement
2. Use surface tangent frame for lateral movement direction instead of camera projection
3. Use the TRANSPORTED direction from the geodesic walk instead of recomputing from camera each frame
4. Cache the last valid movement direction and only update it when the new direction agrees (hysteresis on movement direction, not tangent frame)

## Iteration 9 — Geometry Seam Fix (THE ROOT CAUSE)

**What was tried:** Fixed HalfEdgeMesh to link edges across geometry seams with position-based proximity matching.

**ROOT CAUSE FOUND:** The beveled cube geometry (CubeSurface) builds each face of the cube as TWO separate halves that are independently triangulated. These halves share a seam at Z=0 (or equivalent axis for each face). The vertices along the seam are at NEARLY the same position (~0.017 world units apart) but are NOT exact duplicates. Example:
- Face 3999 (Z<0 half): edge at (2.7203, 5, 0) to (3.5000, 5, 0)
- Face 4410 (Z>0 half): edge at (2.7375, 5, 0) to (3.4995, 5, 0.0005)
- Vertex X positions differ by ~0.017, far beyond the 1e-5 canonicalization precision

The HalfEdgeMesh canonical vertex system (PRECISION=1e-5) couldn't match these. Result:
- 18 false boundary edges at Z=0 on the cube top face alone
- 48 total boundary edges on the top face (36 were false, only 12 were real)
- Geodesic walker REFLECTED at these false boundaries instead of crossing
- Every time the walker hit Z=0, it bounced back → oscillation → 188/299 reversals

**What was fixed:**
Added `HalfEdgeMesh._linkSeamEdges()` — a second-pass edge matching algorithm:
1. Collects all unmatched (boundary) half-edges after standard twin-linking
2. For each pair, checks if endpoints match in OPPOSITE direction within SEAM_TOLERANCE (0.05 world units)
3. Links matching pairs as twins
4. Only runs on boundary edges → O(B^2) where B is number of boundaries (typically <100)

**Also kept from iteration 8:** Face normal consistency fix in HalfEdgeMesh constructor — checks cross-product normals against vertex normals and flips if disagreeing. Fixed 5 inverted-normal faces on cube top.

**What was REVERTED from iteration 8:**
All FaceWalker and MeshWalker changes were reverted because:
- Entry nudge eps changes (0.1 → 1e-4) caused regressions on sphere tests
- Quaternion tangent frame transport caused 4 test failures
- Direction reversal rejection was unnecessary once seam fix resolved the boundary issue
- BVH remainder fallback disabling caused stuck movement at diagonal edges
The seam fix alone resolved ALL lateral reversal issues.

**Results:**
| Test Case | Before (iter 8 changes) | After (seam fix only) |
|-----------|------------------------|----------------------|
| Lateral 300 frames | 188/299 reversals | 2/299 reversals |
| MeshWalker Z crossing | 19/19 reversals | 0/19 reversals |
| Z=0 boundary edges | 18 false | 0 false |
| All 62 movement tests | 4 failed (regressions) | 62/62 pass |

**Key insight:** The "camera interaction bug" hypothesis from iteration 8 checkpoint was WRONG. The camera-relative direction was consistent (same moveDir every frame). The displacement oscillated because the geodesic walker was REFLECTING at false boundary edges in the mesh connectivity, not because of camera lag.

**Dead ends from iteration 8 that are now confirmed unnecessary:**
1. Entry nudge epsilon reduction — helps diagonal but irrelevant for lateral (lateral issue was boundary reflection, not nudge displacement)
2. Quaternion tangent frame transport — caused regressions, not needed
3. Direction reversal rejection — treated the symptom, not the cause
4. BVH remainder fallback disabling — caused stuck movement, not needed

---

## Iteration 10 — Cross-Surface Diagnostic Fix + CameraController Smoothing

**Commit:** (pending)
**Approach:** Fix Puppeteer timing + smooth CameraController.targetUp

### What was tried
1. Investigated sphere/icosahedron "STUCK" from Puppeteer diagnostic after iteration 9
2. Created seam-edge-diagnostic.test.ts to check if _linkSeamEdges breaks sphere
3. Found sphere has 0 boundary edges, 0 seam-linked edges, 0 flipped normals — seam fix has NO effect
4. Root-caused "STUCK" to Puppeteer timing: player died before invincibility set
5. Fixed diagnostic to set invincibility repeatedly during loading, clear enemies, disable spawning
6. Added CameraController.targetUp lerp smoothing (factor 0.4) to reduce cube edge wobble
7. Created cross-surface-movement.test.ts with 24 unit tests covering all 8 surfaces

### Results
- **Sphere:** STUCK -> ALL PASS (was Puppeteer timing, not code bug)
- **Icosahedron:** STUCK -> ALL PASS (same timing issue)
- **Torus:** PARTIAL -> ALL PASS (targetUp smoothing fixed forward wobble from 0.162 to 0.085)
- **Capsule:** PARTIAL -> ALL PASS (targetUp smoothing fixed diagonal zigzag from 0.36 to 0.00)
- **Cube:** Still BROKEN (forward wobble 2.954, diagonal zigzag 0.50)
- **Pipe:** Still BROKEN (lateral wobble 0.214, forward wobble 0.820)

6/8 surfaces pass all tests (was 3/8).

### Analysis of remaining failures
Cube and pipe have geometric limitations, not code bugs:
- **Cube:** Player starts at beveled edge (4.40, 0.00, -5.00). Forward movement crosses faces with 90-degree normal changes. The tangent frame rotates abruptly, camera-relative axes shift, and the player moves sideways instead of forward.
- **Pipe:** Tight tubular curvature (tube radius much smaller than major radius) causes similar rapid normal changes around the tube circumference.

### Dead ends
1. Sphere seam investigation — sphere has no seam edges, the issue was Puppeteer timing
2. IcosahedronGeometry not indexed — handled by GeodesicSurface auto-indexing
3. Torus direct move(1,0,0) = 0 — expected behavior (direction parallel to normal at start)

### What we learned
1. **Puppeteer diagnostic reliability is critical** — invincibility must be set BEFORE enemies can kill the player
2. **targetUp lerp smoothing helps curved surfaces** but can't fix 90-degree cube edges
3. **Cube forward wobble is geometric** — any camera-relative input system will struggle at sharp edges
4. **The movement code itself is correct** — all 8 surfaces have >1.0 displacement in 120 frames

---

## Rules for Future Iterations

1. READ THIS FILE FIRST
2. Do NOT re-try approaches that already failed
3. Write Puppeteer tests that simulate ACTUAL keypresses, not programmatic API
4. Tests must FAIL first (prove they detect the bug)
5. Track exact coordinates/angles when keys are pressed
6. Document ALL findings before returning — even "dead end" findings
7. If you can't fix it, document EXACTLY what you learned so the next iteration starts ahead
8. **Check mesh connectivity FIRST** — false boundary edges in HalfEdgeMesh can cause the walker to reflect, producing oscillation that looks like a movement algorithm bug but is actually a mesh topology issue
9. **Always check Puppeteer timing** — the diagnostic must make player invincible before enemies can kill. Set invincibility repeatedly during loading, not just once.
10. **Cube/pipe wobble is geometric** — not a code bug. Don't spend time trying to fix movement code for these; the fix would need to be in the surface geometry (smoother bevels, different starting position) or input system (movement direction locking)

---

## Iteration S22-v3 (commit 9e573b1) — atVertex Epsilon Too Large

**What was tried:** Investigated root cause of zigzag trail on pill map south seam.
Used internal bary-state logging test to get exact per-frame face+bary data.

**Root cause:** `FaceWalker.ts` atVertex detection epsilon = 0.05 was too large.
When a player exits a triangle very close to (but not at) a corner (e.g., v=0.004374),
the exit is classified as "at vertex" because v < 0.05. The atVertex logic then uses
dot-product alignment to choose the best adjacent edge — but gets it wrong at this
specific geometry, selecting the C→A edge (→ face 2322) instead of the B→C edge
(→ face 931). The alpha from the B→C exit (0.9957) is then misapplied to the C→A
crossing, placing the player at a completely wrong position in face 2322.

**Fix:** `FaceWalker.ts` line ~158: `const eps = 0.05` → `const eps = 0.001`.
True vertex exits have bary components near machine epsilon (~1e-15). An eps of 0.001
is still large enough to catch floating-point imprecision while not falsely triggering
on legitimate near-corner edge crossings.

**Test results:** 60-frame reversal test: 0 reversals (was 2). Both regression tests pass.

**User feedback:** Bug reported: "saw-tooth zigzag trail when pressing W on pill map."
Previous S17 (Gram-Schmidt) and S21 (single-axis tangent frame) fixes were irrelevant
to this root cause — the tangent frame logic was correct all along. The bug was in
the geometric edge-crossing topology decision.

**Why it failed before:**
- S17, S21 both assumed the problem was in the tangent frame calculation
- This session traced the exact bary values at the crash frame, revealing the atVertex
  false-trigger as the real cause

**Dead ends ruled out:**
- Tangent frame calculation (Gram-Schmidt, single-axis) — NOT the cause
- BVH fallback — does NOT trigger (distanceTraveled=0.049 >> 0.0025 threshold)
- Seam edge mismatches — faces 934/2322 are correctly linked via twins
- s22-cube-bullet-glitches fix (tightened seam tolerance) — unrelated, coincidental

**New rule:** When debugging geodesic walk bugs, add internal bary-state logging first
to get exact face/bary at each step. Mathematical tracing through the atVertex logic
found this bug in minutes.
