# Human Test Checklist

> **What is this?** Everything Claude has changed that needs YOU to verify in a real browser. Items are grouped by system. Check them off as you go. If something fails, note what happened — Claude will read this file next session.
>
> **Last updated:** 2026-02-17
>
> **Visual Test Results (2026-02-12, commit a722f6a):** Headless Puppeteer + SwiftShader testing completed. Items marked `[V5 PASS]` were verified visually at Level 5. Items marked `[V5 INCONCLUSIVE]` could not be tested headless (need real browser). See `tasks/visual-test-human-todos.md` and `tasks/lan-visual-testing.md` for full details.

---

## Session 25 LAN Pause Menu — Escape Key (2026-02-20)

Start a LAN game (host + at least one non-host player).

### Non-Host Player (the main fix)

- [ ] **Escape opens menu** — As a non-host player, press Escape during gameplay. A "MENU" overlay should appear.
- [ ] **Menu shows correct options** — Should show: RESUME GAME, RETURN TO MAIN MENU. Should NOT show STOP SERVER.
- [ ] **Warning is visible** — Menu shows "⚠ Game continues — you can still be hit by enemies".
- [ ] **Escape closes menu** — Press Escape again. Menu disappears, game resumes normally.
- [ ] **Resume button works** — Click "▶ RESUME GAME". Menu closes, player movement resumes.
- [ ] **Return to menu button** — Click "◀ RETURN TO MAIN MENU". Disconnects and navigates to the start screen.
- [ ] **Player stops moving while menu is open** — While menu is open, verify other players see this player standing still (zero input sent to server).
- [ ] **Other players unaffected** — Open menu as non-host. Host and other non-hosts should see the game still running normally (enemies moving, their own movement unchanged).

### Host Player

- [ ] **Escape opens menu** — As host, press Escape. Menu appears with RESUME GAME, RETURN TO MAIN MENU, AND STOP SERVER.
- [ ] **Stop Server button works** — Click "⏹ STOP SERVER (ALL PLAYERS)". All players should be disconnected and returned to menu.
- [ ] **Host escape no longer pauses server** — Opening the local menu (Escape) does NOT freeze other players' game. (The old host-only server pause via Escape is replaced by this menu; server-controlled pause still works via other mechanisms.)

**Verification level:** Level 0 (code analysis only) — LAN requires human testing.

---

## Session 25 Playground Aiming + Hit Detection Fix (2026-02-19)

### Visual Styles Playground

Open the Visual Styles page (click any style thumbnail → playable demo launches):

- [ ] **Player faces aim direction** — Move the mouse around; the player ship rotates to face the cursor. Should NOT be on the wrong axis or spinning.
- [ ] **Bullets travel toward cursor** — Fire (click/hold). Bullets should travel in the direction the mouse is pointing.
- [ ] **Bullets hit enemies** — Aim at a visible enemy and fire. Bullets should visually collide and kill the enemy (enemy disappears with particle effect + geom drops). Bullets must NOT pass through.
- [ ] **Smooth 60 FPS** — No lag or stutter during gameplay.

### Weapons Database Playground

Open the Weapons Wiki page → "Try It" button for any weapon:

- [ ] **Player faces aim direction** — Same as above; ship should rotate correctly.
- [ ] **Each weapon type hits enemies** — Cycle through 3+ weapons (the weapon switch buttons). Fire each one at an enemy. All weapon types should kill enemies (not pass through).
- [ ] **No lag** — Should be smooth 60 FPS, no slowdown.

**Root causes fixed (2026-02-19):**
- Cross product order in GameInstance.ts:533 was `crossVectors(aimDirection, playerNormal)` — produces left-handed (mirrored) basis. Fixed to `crossVectors(playerNormal, aimDirection)` matching GameLoop.ts.
- No bullet-enemy collision check existed in GameInstance.update(). Added `_checkBulletEnemyCollisions()` using `bulletPool.forEachActive()` with distance check.

---

## Session 24 Selective Bloom Masking (2026-02-19)

### Bloom Visual Quality — Arena Should NOT Glow, Enemies SHOULD

With bloom threshold at 0.3, only objects with luminance > 0.3 contribute to bloom. The dark arena surface and grid should NOT have a glow halo around them, while enemies, bullets, and the player SHOULD glow.

- [ ] **Arena surface is non-glowing** — The dark blue/black surface mesh should appear as a flat, non-glowing surface. No halo or bloom glow around the surface itself. If the surface appears to "glow" with a foggy bloom overlay, the threshold is too low.
- [ ] **Grid lines are non-glowing** — The arena grid lines should be crisp, dim blue lines without a glow halo. Grid should look like a grid, not a glowing web.
- [ ] **Enemies visibly glow** — Enemies should have a clear bloom glow around them — neon-style glowing shapes. The glow radius should be visible.
- [ ] **Bullets have glow trails** — Fired bullets should leave bright glowing streaks. Neon glow should be clearly visible.
- [ ] **Player ship glows** — The player ship/ship model should have a subtle neon glow around it.
- [ ] **Title screen bloom looks good** — The "GEOMETRY WARS 3D" title in the start menu should have a vivid cyan bloom effect (already verified via Puppeteer Level 5).

**What was verified (2026-02-19):**
- `DEFAULT_BLOOM.threshold = 0.3` in `src/core/Game.ts` — only pixels with luminance > 0.3 bloom
- Arena surface: `MeshBasicMaterial`, color `0x141440`, luminance ≈ 0.091 → **does NOT bloom** ✓
- Arena grid: `LineBasicMaterial`, color `0x2a2aaa`, luminance ≈ 0.201 → **does NOT bloom** ✓
- Enemies: `emissiveIntensity` ≥ 1.2 → **WILL bloom** ✓
- Bullets: `emissiveIntensity` = 0.6 → **WILL bloom** ✓
- Player: `emissiveIntensity` = 0.4 → **WILL bloom** ✓
- 12 regression tests added in `src/rendering/SelectiveBloom.test.ts` (all pass)
- Puppeteer screenshot confirms title + menu bloom looks correct, arena background is dark

**Verification level:** L5 (Puppeteer screenshot). Needs human testing to confirm in-game gameplay bloom quality.

---

## Session 24 LOD System Wiring Verified (2026-02-19)

### LOD (Level of Detail) Enemy Rendering

The LOD system is active and reduces triangle count for distant enemies. Enemies beyond 60 units use simplified icosahedron geometry (MEDIUM), and beyond 120 units use billboard quads (LOW).

- [ ] **LOD geometry switching visible on large maps** — On a map where you can see enemies far away (e.g., sphere or torus with 50+ enemies), enemies far from the camera should appear as simplified glowing shapes (icosahedrons) rather than complex geometry. This is subtle — the key indicator is smoother, more rounded shapes at distance.
- [ ] **No enemy disappearing** — All enemies should remain visible regardless of LOD level. LOD should change geometry shape, not remove enemies.
- [ ] **Positions remain correct** — Enemies at MEDIUM/LOW LOD should still be at their correct world positions (not offset or jittered).
- [ ] **LOD stats visible in F3 overlay** — Press F3 during gameplay with 50+ enemies. The debug overlay should show LOD stats (high/medium/low counts). Confirm the counts change as enemies move closer/farther.
- [ ] **Performance at 200 enemies** — Spawn 200 enemies (multiple wave cycles in Waves mode). FPS should be higher (or at least equal) compared to before LOD was active, due to triangle count reduction for distant enemies.

**What was verified (2026-02-19):**
- `LODManager` is instantiated in `main.ts` (line 619) and passed to `GameContext`
- `GameLoop.ts` calls `ctx.lodManager.update(camera, enemies)` each fixed step (lines 249-251)
- `EnemyInstanceManager.updateInstancesWithLOD()` is called with LOD assignments (lines 257-262)
- `RenderLoop.ts` applies LOD-based opacity adjustments (lines 137-142) and routes visibility to correct batch
- 29/29 LODManager unit tests pass
- 34/34 EnemyInstanceManager unit tests pass (including LOD batch methods)

**Verification level:** L2 (unit tests pass). Needs human testing to confirm visual geometry switching.

---

## Session 22 Camera Jerk Fix (2026-02-18)

### Camera Smoothness on All Maps

- [ ] **Camera follows smoothly on sphere** — Move the player with WASD. Camera should track instantly and smoothly. No "camera repositions itself" after a short delay. Every keypress should produce immediate camera response.
- [ ] **Small movements feel responsive** — Tap a key briefly (single press). Camera should respond immediately, not "dead frame then snap."
- [ ] **No jerk when stopping** — Stop pressing keys abruptly. Camera should stop without any catch-up snap or lurch. Previously the lerp would "finish catching up" after release.
- [ ] **Works on torus, cube, capsule** — Try the fix on multiple map types. Camera up-vector should track the surface normal smoothly on all surfaces.
- [ ] **Orbit (middle-mouse drag) still works** — Middle-click drag to orbit the camera. Should still work correctly.

**What was changed:**
- `src/core/CameraController.ts`: Removed velocity-damped up-vector lerp (`0.15/(1+v*25)`). Now uses `camera.up.copy(bitangent)` directly each frame. lookAt called AFTER the up update. Bitangent is stable (iteration 7 Gram-Schmidt fix) so no smoothing needed.
- `src/core/CameraController.jerk.test.ts` (NEW): 5 regression tests. Run `npm test src/core/CameraController.jerk.test.ts` to verify camera smoothness programmatically.

---

## Session 22 Enemy Visibility Scaling (2026-02-18)

### Far-Side Enemy Culling at High Entity Counts

- [ ] **Far-side enemies hidden at 200+ entities** — Spawn 200+ enemies (Waves mode, wait for many waves). Enemies on the BACK of the sphere (the side you can't see directly) should be invisible or nearly invisible. If you can see glowing enemy shapes through the sphere, that's a failure.
- [ ] **Bosses still visible on far side** — A boss enemy on the far side of the sphere should still be dimly visible (glow effect at ~10% opacity), not completely hidden. Confirms boss threat visibility is preserved.
- [ ] **Smooth horizon fade, no popping** — As you move around the sphere, enemies should gradually fade in as they come over the horizon, not pop in abruptly. Watch the horizon edge carefully.
- [ ] **Near-side enemies fully visible** — Enemies on YOUR side of the sphere (near the player) should look exactly the same as before — no unintended dimming.
- [ ] **Below 150 enemies: no change** — Kill enemies until fewer than 150 are on screen. Far-side enemies should reappear (depth occlusion still hides them behind surface, but the entity-count culling is off).
- [ ] **Player is clearly visible** — Even with 200+ enemies on screen, the player ship/character should be clearly visible. Player is not affected by far-side culling.

### Death Effect Scaling

- [ ] **Shockwave less distorting at 200+ enemies** — When killing many enemies simultaneously (bomb, or heavy shooting in a crowd), the screen distortion (shockwave effect) should be less intense than before. Previously, many simultaneous deaths caused heavy chromatic distortion.
- [ ] **Shockwave still visible at low counts** — With fewer than 100 enemies on screen, death shockwaves should feel the same as before (full intensity).
- [ ] **Boss death still impactful** — A boss death shockwave should still feel significant (though scaled at high counts).

**What was changed:**
- `RenderLoop.ts`: At 150+ entities, regular enemies on the far side of the surface (dot product with camera < -0.10) are hidden. Smooth fade zone near horizon (dot between -0.10 and 0.15). Bosses are exempt.
- `GameLoop.ts`: Death shockwave strength scaled down at high entity counts. Formula: `max(0.3, 1.0 - max(0, count-100)/200)`. At 200 enemies → 0.5×. At 300+ enemies → 0.3× minimum.

**Verification level:** L1 (TypeScript compiles clean). Needs human testing.

---

## Session 21 Camera Smoothing v2 (2026-02-17)

### Camera Smoothing
- [ ] **Camera feels smoother on sphere** — Move around sphere for 30+ seconds. Camera should NOT lurch when crossing triangle edges. Up-vector change should be gradual.
- [ ] **No lurch on pill surface** — Pill has high triangle-edge density. Camera should feel smooth, no visible snapping or lurching upward.
- [ ] **Position still responsive** — Camera should follow player position promptly (no major lag). Position lerp stays at 0.12 as before.
- [ ] **Smooth on all maps** — Test sphere, pill, torus, cube. All should feel smoother than before.

**What was changed:**
- `CAMERA_UP_LERP` lowered from `0.06` → `0.03` (halved — Approach 1)
- Added velocity-based damping: during rapid up-vector changes (triangle edge crossings), lerp factor is further reduced to `0.03 / (1 + velocity * 10)` (Approach 3)
- All regression guards preserved. Position lerp unchanged at 0.12.

**Status:** READY FOR HUMAN TESTING. Branch: task/s21-camera-smoothing-v2.

---

## Session 20 Movement Oscillation Fix (2026-02-17, commit 7e694c2)

### CRITICAL FIX - MUST TEST (Programmatically Verified Level 2)
- [ ] **Forward movement on pill is smooth** — Hold W (forward) for 3+ seconds on PILL surface. Player should move smoothly WITHOUT zigzagging left/right in an "X pattern". Movement should be straight forward.
- [ ] **Diagonal movement on pill is smooth** — Hold W+D (diagonal) for 3+ seconds on PILL surface. Should move in smooth diagonal, NOT stuttering or switching between component axes.
- [ ] **Player rotation is correct** — Rotate player with mouse while moving. Player mesh should rotate around the surface normal (spinning in place), NOT rotating around wrong axis (like rolling or tumbling).
- [ ] **Gun fires toward mouse** — Fire bullets while rotating. Bullets should travel toward mouse cursor position.
- [ ] **No regressions on other surfaces** — Test forward/diagonal movement on sphere, cube, torus. Should be smooth on all surfaces.

**What was fixed:**
User reported "X pattern" oscillation: move forward → shift left → forward → shift right 2x → repeat. Also reported wrong rotation axis. Root cause: MeshWalker._updateTangentFrame() dual Gram-Schmidt projection didn't check for 180° sign flips at triangle edges. When bitangent (forward direction) flipped, control system compensated laterally causing zigzag. Fix: Added sign-flip detection (dot product < 0) and negate to maintain consistent orientation, mirroring CameraController's approach.

**Programmatic Verification (Level 2):**
- 56 MeshWalker tests pass ✅
- 18 camera-relative input tests pass ✅
- Tangent frame stability test passes ✅
- 0 regressions to enemy movement or surface queries

**Status:** READY FOR HUMAN TESTING. Commit 7e694c2 on branch task/s20-player-movement-oscillation-fix.

---

## Session 19 Camera Smoothing Fix (2026-02-17)

### Critical Fix - MUST TEST (Programmatically Verified Level 4)
- [ ] **Diagonal movement feels smooth** — Hold W+D (diagonal) on sphere/torus for 5+ seconds. Camera should follow smoothly WITHOUT visible snapping or alternating between showing right-then-forward-then-diagonal directions. The movement should feel fluid, not jerky or "stilted."
- [ ] **Camera follows without lag** — Move in any direction. Camera should track the player responsively without noticeable delay (lerp 0.2 = ~12 frames to converge 90%).
- [ ] **Gun still aims at mouse** — Fire while moving in various directions. Bullets should travel toward mouse cursor, not at wrong angles.
- [ ] **No regression on other surfaces** — Test on sphere, cube, torus, pill. Movement should feel smooth on all surfaces.

**What was fixed:**
User reported diagonal movement felt "stilted/broken" with camera "going in one of those two directions (that builds the diagonal), then the other, before going back to diagonal" causing jerky oscillation. Root cause: tangent frame flips at triangle edge crossings exposed by instant camera follow (zero lerp from Session 19 attempt). Solution: Re-enabled camera smoothing with lerp factors (position 0.2, up vectors 0.15) to filter single-frame jumps while maintaining responsive following.

**Programmatic Verification (Level 4):**
- Camera stability tests: ✅ 5/5 passed
- Gun direction accuracy tests: ✅ 8/8 passed
- Movement direction drift tests: ✅ Diagonal oscillation test now PASSES (was expected to fail)
- TypeScript compiles clean (0 errors in CameraController.ts)

**Status:** READY FOR HUMAN TESTING. Commit pending (branch task/s19-camera-meshwalker-fix).

---

## Session 15 Player Movement Fix — Iterations 6-9 (2026-02-13/14)

### Critical Bug Fix - MUST TEST (Programmatically Verified Level 2)
- [ ] **Cube lateral movement is smooth** — Press D (right) on CUBE surface for 3+ seconds. Player should move smoothly rightward without oscillating or reversing direction.
- [ ] **No chevron spinning** — Press A or D on sphere for 5 seconds. The player chevron should NOT spin rapidly or show multiple copies in the same spot.
- [ ] **No map jumping** — Hold D for 5 seconds on sphere. The map/sphere should rotate smoothly, NOT jump in large discontinuous steps.
- [ ] **Forward movement is smooth** — Press W for 5 seconds. Player should move in a consistent direction, NOT veer left/right or jitter.
- [ ] **Diagonal movement works** — Press W+D for 5 seconds. Player should move in smooth diagonal arc, NOT "square fashion" with 90° snaps.
- [ ] **All surfaces work** — Test on sphere, pill (capsule), cube, and torus. Movement should be smooth on all.

**What was fixed (iterations 6-9):**
1. **Iteration 6:** Tangent frame swap hysteresis, orientation slerp smoothing, camera convergence speed increase.
2. **Iteration 7:** Dual Gram-Schmidt tangent frame transport (replaced swap-based approach).
3. **Iteration 9 (LATEST):** HalfEdgeMesh seam edge linking. ROOT CAUSE: Beveled cube geometry has seams where two halves of each face are built independently, creating false boundary edges. The geodesic walker reflected at these boundaries, causing 188/299 lateral displacement reversals. Fix: `_linkSeamEdges()` proximity-based edge matching (tolerance 0.05) links edges across geometry seams. Result: 2/299 reversals (only at true cube corners).

**Programmatic Verification (Level 2):**
- 65/65 movement tests pass (18 camera-relative + 27 surface + 17 integration + 3 cube-lateral)
- 3 new regression tests verify no false boundary edges, smooth seam crossing, and <5 reversals in 300 frames
- 0 regressions introduced
- TypeScript compiles clean (0 errors in changed source files)

**Status:** READY FOR HUMAN TESTING at 60 FPS (Level 6 verification needed). Commit 1635dbf.

### Iteration 10 — Cross-Surface Diagnostic Fix (2026-02-14)

**Puppeteer Level 5 verified (6/8 surfaces ALL PASS):**
- [x] Sphere: lateral, forward, diagonal all pass (wobble < 0.10)
- [x] Pill: lateral, forward, diagonal all pass (wobble < 0.08)
- [x] Torus: lateral, forward, diagonal all pass (wobble < 0.09)
- [x] Capsule: lateral, forward, diagonal all pass (wobble < 0.09)
- [x] Peanut: lateral, forward, diagonal all pass (wobble < 0.07)
- [x] Icosahedron: lateral, forward, diagonal all pass (wobble < 0.08)
- [ ] Cube: forward wobble 2.954, diagonal zigzag 0.50 (known geometric limitation — beveled edges)
- [ ] Pipe: lateral wobble 0.214, forward wobble 0.820 (known geometric limitation — tight curvature)

**What was fixed (iteration 10):**
1. Puppeteer diagnostic timing — player was dying before invincibility took effect on some surfaces
2. CameraController.targetUp lerp smoothing (factor 0.4) — reduces movement axis disruption at cube edges

**Status:** READY FOR HUMAN TESTING. Commit 1998383.

---

## Session 13 Game Regression Fixes (2026-02-12)

### Critical Bug Fixes - MUST TEST (Programmatically Verified Level 4)
- [ ] **Player movement is smooth** - Move with A/D keys on sphere surface for 30 seconds. Player should NOT have visible up/down jitter or wobble during horizontal movement.
- [ ] **Bullets can hit enemies without freezing** - Spawn multiple enemies, shoot them continuously for 60 seconds. Game should NOT freeze when bullets hit enemies.
- [ ] **Enemy positions update correctly** - Watch enemies move around surface. They should move smoothly without getting stuck or teleporting. Check minimap (if visible) to confirm enemy positions update.

**Programmatic Verification (Level 4):** All 3 fixes passed 60-second integration test:
- ✓ Collision freeze: 3525 frames advanced continuously (no freeze)
- ✓ Enemy UV sync: Enemy UV coordinates updated correctly (Δ0.153 UV units)
- ✓ Player movement: No position discontinuities detected (max Δ3.3 units)

**Status:** READY FOR HUMAN TESTING (Level 6 verification needed for final sign-off)

---

## How to Run

```bash
# Single player
Play Game.bat                    # or: npm run dev

# LAN multiplayer
Play Game.bat                    # starts both Vite + Colyseus
# Open http://localhost:3000?mode=network in two browser tabs
# Tab 1: click "Host Game"
# Tab 2: click "Join Game"
```

---

## LAN Multiplayer (HIGHEST PRIORITY — 10+ fix attempts, never verified working)

These fixes were all made in commits `39e5540`, `9da6c5a`, `b1043d9`, `7af24be` on 2026-02-11. None have been user-tested.

### Core Playability
- [ ] **Both players can move smoothly** `[V5 INCONCLUSIVE - died too fast]` — WASD on both tabs, movement should feel responsive (not jerky/teleporting)
- [ ] **Bullets fire in correct direction** `[V5 INCONCLUSIVE - died too fast]` — Aim with mouse, fire. Bullets should go toward crosshair, not random directions
- [ ] **Bullets move smoothly** `[V5 INCONCLUSIVE - died too fast]` — Bullets should glide, not snap/teleport between positions
- [ ] **Geoms (score pickups) move smoothly** `[V5 INCONCLUSIVE - died too fast]` — Same as bullets, should lerp not snap
- [ ] **Enemy movement is smooth** `[V5 INCONCLUSIVE - died too fast]` — Enemies should move fluidly, not stutter at 30fps intervals
- [ ] **Player aim updates while stationary** `[V5 INCONCLUSIVE - died too fast]` — Stand still, move mouse around. Player should visually rotate to face cursor instantly

### Robustness
- [ ] **Tab-out doesn't break movement** `[V5 INCONCLUSIVE]` — Alt-tab away from one tab, come back. Player should stop moving while unfocused, resume on return
- [ ] **No spawn ring ghosts** `[V5 PASS]` — Kill enemies. Should NOT see lingering circular warning rings where enemies spawn
- [ ] **Respawn works** `[V5 POTENTIAL ISSUE - players stayed dead ~90s]` — Die, respawn. Player should be visible and controllable after respawn (not invisible)
- [ ] **Cube surface works** — Select cube map. Player should NOT get stuck at origin (0,0). Can move freely everywhere
- [ ] **Overall feel** — Does it feel like a playable game, or "laggy and weird"?

### Performance
- [ ] **Stable 60 FPS** `[V5 INCONCLUSIVE - SwiftShader]` — Open Chrome DevTools Performance tab. FPS should stay near 60, not dip to 30-40
- [ ] **No debug spam** `[V5 PASS]` — Console should NOT show LAN debug messages unless `?debug` is in URL

### LAN Connection (V5 PASS — re-verified 2026-02-17, 13/13 automated tests PASSED)
- [x] **Host game flow works** — LAN -> HOST GAME -> surface select -> START HOSTING -> ENTER GAME
- [x] **Join game flow works** — LAN -> lobby discovers hosted game -> click to join
- [x] **Both players render** — Both player characters visible on sphere with name labels
- [x] **Enemies spawn in LAN** — Grunts appear and move
- [x] **Score tracking works** — Host scored 100 points, kill log shows "Grunt x2"
- [x] **No console errors** — 0 critical errors on either page
- [x] **Two clients connect simultaneously** — Both get unique session IDs, server shows players.size=2
- [x] **Game stable 17+ seconds** — No disconnects, both clients still connected after extended play
- [x] **User testing required** — Full LAN on two physical devices on same network still needs human test

### LAN Task Files (for investigating failures)
- `tasks/lan-quick-wins-audit.md` — 60Hz patches, depth opacity removal, interpolation
- `tasks/lan-window-focus-control.md` — Tab focus handling
- `tasks/lan-spawn-rings-persist.md` — Ghost spawn rings
- `tasks/lan-respawn-invisible.md` — Invisible after death
- `tasks/lan-bullet-angle-wrong.md` — Bullet direction
- `tasks/lan-origin-blocking-cube.md` — Cube origin blocking
- `decisions/lan-deep-audit-2026-02-11.md` — Full 12-issue audit

---

## Main.ts Refactor (commit `b7a0923`)

The god function was split into 8 modules. Game behavior should be identical.

- [ ] **Player movement** `[V5 PASS]` — WASD moves player in all directions on all surfaces
- [ ] **Shooting** `[V5 INCONCLUSIVE - headless mouse events]` — Click to fire, bullets hit enemies, enemies die
- [ ] **Pickups spawn** `[V5 INCONCLUSIVE]` — Kill enemies, weapon/buff/companion pickups appear
- [ ] **Pickup collection** `[V5 INCONCLUSIVE]` — Walk over pickups, buffs activate, weapons switch
- [ ] **Camera controls** `[V5 INCONCLUSIVE - scroll events]` — Mouse wheel zoom, middle mouse orbit
- [ ] **Screen flash** `[V5 INCONCLUSIVE]` — Death/protector activation should flash screen
- [ ] **UI updates** `[V5 PASS]` — Score, multiplier, lives, bombs all update correctly
- [ ] **Pause menu** `[V5 PASS]` — ESC opens pause, shows stats, can resume

### Refactor Task File
- `tasks/refactor-main-god-function.md`

---

## Game Modes (commit `b7a0923`)

4 new modes added alongside default Waves mode.

- [ ] **Mode selector visible** `[V5 PASS]` — Start menu "Quick Game" should show mode dropdown
- [ ] **Waves mode** `[V5 PASS]` — Default behavior, enemies spawn in waves
- [ ] **King mode** `[V5 PASS]` — Safe zones appear, must stand in zone to score
- [ ] **Rainbow mode** `[V5 PASS]` — Kill enemies in color order for bonus multiplier
- [ ] **Sniper mode** `[V5 PASS]` — Limited ammo, precision kills rewarded
- [ ] **Claustrophobia mode** `[V5 PASS]` — Shrinking play area

### Game Modes Task File
- `tasks/game-modes-implementation.md`

---

## Sound System (commits `07aee82`, earlier)

- [ ] **No audio distortion** — At high enemy counts (100+), sound shouldn't clip/crackle
- [ ] **Sounds don't stack infinitely** — Killing 20 enemies fast shouldn't produce 20 overlapping explosions
- [ ] **Volume is reasonable** — Not too loud, not too quiet

### Sound Task Files
- `tasks/sound-overwhelm-reinvestigate.md`
- `tasks/lan-still-broken-sound.md`

---

## Mobile Pixel Ratio Cap (s24-perf-02) — 2026-02-19

**What was changed:** Mobile devices now cap pixel ratio at 1.5 (was 2.0). Desktop devices are unchanged.
- `src/core/Game.ts`: UA + `devicePixelRatio > 2` detection → `maxPixelRatio = 1.5` for mobile, `2.0` for desktop.
- `src/main.ts`: In the `if (mobile)` block, cap changed from `2` → `1.5`.

**Expected improvement on high-DPI mobile:** ~44% reduction in GPU fill work (1.5² = 2.25 vs 2.0² = 4.0 pixels per CSS pixel). Should improve FPS on 3x/4x/5x displays (modern iPhones, Samsung Galaxy).

**Expected behavior on desktop:** ZERO change. Desktop devices have pixel ratio 1.0–2.0, so the cap of 2.0 is unchanged.

- [ ] **Test on mobile device — visually acceptable** — Open the game on an iPhone or Android device with high-DPI display (pixel ratio ≥ 3). Game should look sharp and smooth. Slightly less crisp than before (1.5x vs 2x) but not noticeably blurry.
- [ ] **Desktop unchanged** — Open on a desktop/laptop. Rendering should look identical to before. Press F3 to open debug overlay and confirm pixel ratio is NOT affected (still uses native ratio up to 2.0).
- [ ] **FPS improvement on mobile** — On a 3x+ display, the game should run measurably smoother than before, especially on mid-range devices.

---

## Performance (commits `07aee82`, `a960932`)

- [ ] **No FPS crater at high scores** `[V5 INCONCLUSIVE - SwiftShader]` — Play until 450M+ score. FPS should stay above 30
- [ ] **Explosion particles don't tank FPS** `[V5 INCONCLUSIVE - SwiftShader]` — Chain explosions (many enemies dying at once) should not drop below 30fps
- [ ] **Performance graphs work** `[V5 PASS]` — Pause menu → Performance → graphs should display data

### Performance Profiling Overlay (NEW — 2026-02-16)

Real-time performance profiler that shows CPU hot spots during gameplay. Part of Phase 3 of the profiling dashboard.

- [ ] **Profiling overlay toggles with F4** — Press F4 → overlay should appear in top-right corner
- [ ] **Shows top 8 CPU consumers** — Overlay should list 8-10 systems/scopes sorted by time (e.g., "enemy_update", "render_draw", "particle_update")
- [ ] **Frame time is visible** — Should show current frame time (e.g., "13.2ms") vs budget (16.67ms for 60fps)
- [ ] **Percentage and visual bars** — Each scope should show percentage of frame budget and a visual bar chart
- [ ] **Color-coded frame time** — Green when under 80% budget, orange 80-100%, red over 100%
- [ ] **Profiling ON/OFF button works** — Click button in overlay → profiling should toggle on/off (status text updates)
- [ ] **No performance impact when hidden** — Press F4 to hide → FPS should not change (overlay only updates when visible)
- [ ] **Updates in real-time** — Watch overlay during gameplay → values should update every ~200ms reflecting current CPU usage
- [ ] **Test during explosion spike** — Spawn 200+ enemies, cause mass explosions → overlay should show which system is the bottleneck

### Performance Task Files
- `tasks/fps-crater-reinvestigate.md`
- `tasks/perf-graphs-reinvestigate.md`
- `tasks/performance-drops-450m.md`

---

## Visual Features (various commits)

- [ ] **Enemy opacity behind surfaces** `[V5 INCONCLUSIVE - SwiftShader]` — Enemies on the far side of the surface should be nearly invisible (6% opacity), not glowing through
- [ ] **Enemy surface glow** `[V5 INCONCLUSIVE - SwiftShader]` — Enemies should cast a colored glow on the surface beneath them
- [ ] **Visual styles playground** `[V5 PASS]` — Start menu → Visual Styles → click a style → demo should load and be playable (not spinning wildly)
- [ ] **Weapon playground** — Start menu → Weapons → playground should work (USER VERIFIED WORKING in `bffc333`)
- [ ] **Visual playground collision radius** `[V5 INCONCLUSIVE - needs gameplay]` — In Visual Styles demo, enemies should NOT kill you from far away. Must physically touch enemy to die. (Was 1.7-3.3x too large, now matches main game's CollisionSystem.ts)
- [ ] **Visual playground scroll zoom** `[V5 PASS]` — In Visual Styles demo, scroll wheel zooms camera in/out (matching Weapon Playground behavior)
- [ ] **Visual playground style switching** `[V5 PASS]` — Open Gold Luxury demo → BACK → open Sektori Cyan → should show cyan glow (NOT gold). Try 3+ style switches in a row.

### Visual Task Files
- `tasks/enemy-opacity-behind-surfaces.md`
- `tasks/enemy-surface-glow.md`
- `tasks/visual-styles-playground-broken.md`
- `tasks/visual-styles-playground-v2.md`

---

## Difficulty & Gameplay (commit `07aee82`)

- [ ] **Difficulty feels challenging** `[V5 PASS - enemy count 4->13->400]` — Should get hard by wave 5-10, not trivially easy forever
- [ ] **Enemy speed scales** `[V5 INCONCLUSIVE]` — Later enemies should be noticeably faster
- [ ] **Cube-tunnel speed** `[V5 INCONCLUSIVE]` — Enemies on cube-tunnel should move at similar speed to other surfaces (not 10x faster or 10x slower)

### Difficulty Task Files
- `tasks/difficulty-still-too-easy.md`
- `tasks/cube-tunnel-speed-normalization.md`

---

## WebGPU (UPDATED 2026-02-12 — 3 bugs fixed)

**Fixed:** Silent fallback detection, missing powerPreference, zero diagnostics. Previously the game could REPORT "WebGPU" while actually using WebGL2.

### Step 1: Check your system
- [ ] **Open Chrome DevTools console** → type `__webgpuDiagnostic()` → run it
  - Should show green PASS for navigator.gpu, adapter, and device
  - If any show red FAIL: the diagnostic will explain WHY and how to fix it
- [ ] **Open chrome://gpu** in a new tab → search for "WebGPU" → should say "Hardware accelerated"
  - If it says "Disabled" or "Software only": update your GPU driver

### Step 2: Test WebGPU activation
- [ ] **Start game normally** (`npm run dev` or Play Game.bat) → open Chrome console
  - Console should show `[GPUCapabilities]` group with `WebGPU: available (adapter: ...)`
  - Console should show `[RendererFactory] Created WebGPU renderer (backend: WebGPUBackend)`
  - If you see `WebGPU: NOT AVAILABLE`: the diagnostic in Step 1 explains why
- [ ] **Check Debug Overlay** — Press F3 → should show "WebGPU" in cyan text (not "WebGL2" in blue)
- [ ] **Check Profiling Overlay** — Press F4 → should show real-time performance profiler with top 8 CPU consumers, frame time, and visual bars
- [ ] **Check Settings menu** → System Info → Active Renderer should say "WebGPU"

### Step 3: If WebGPU works, test it
- [ ] **Bloom effects work** — Neon glow visible on WebGPU (not flat/dark)
- [ ] **Bloom settings update in real-time** — Open settings, adjust bloom strength → should change immediately
- [ ] **Visual styles change bloom** — Switch visual styles → bloom should update per style
- [ ] **Fallback works** — Add `?renderer=webgl` to URL → should use WebGL2 with full bloom

### Step 4: If WebGPU does NOT work
- [ ] **Note the error** — What does `__webgpuDiagnostic()` say? What does chrome://gpu say for WebGPU?
- [ ] **Write it here** so Claude can investigate further

### WebGPU Task Files
- `tasks/webgpu-feasibility-research.md` — 3 bugs found and fixed
- `tasks/webgpu-optimization.md` — Previous WebGPU work (bloom settings)

---

## Adventure Mode (NEW — 2026-02-12)

50-level campaign mode with progressive difficulty, star ratings, and level progression.

### Level Select UI
- [ ] **Adventure button visible** `[V5 PASS]` — Start menu shows "ADVENTURE" button as primary option
- [ ] **Level grid displays** `[V5 PASS]` — Click Adventure → shows all 50 levels in 6 sections (Sapphire, Ruby, Emerald, Opal, Amethyst, Topaz)
- [ ] **Locked levels show lock icon** `[V5 PASS]` — Levels after the first should show 🔒 if not unlocked
- [ ] **Star ratings display** — Completed levels should show ★★★ or ★★☆ etc. based on performance
- [ ] **Section headers visible** `[V5 PASS]` — Each gem section (Sapphire, Ruby, etc.) should have a visible header

### Level Gameplay
- [ ] **Level starts on click** `[V5 PASS]` — Click an unlocked level → game should start on the level's surface
- [ ] **Scripted waves spawn** `[V5 PASS]` — Level should spawn specific enemy waves (not random endless waves)
- [ ] **Lives/bombs/time match level** — Check pause menu → stats should match the level's config (e.g., Level 1 has 3 lives, 60s time limit)
- [ ] **Timer counts down (Deadline mode)** `[V5 PASS]` — Levels with time limits should show countdown timer
- [ ] **Timer shows elapsed time (Evolved mode)** — Levels without time limits should show elapsed time

### Level Completion
- [ ] **Level completes when waves clear** — Kill all enemies in all waves → Level Complete screen should show
- [ ] **Star rating displays** — Level Complete should show 1-3 stars based on score
- [ ] **Star rating is accurate** — Check score vs. level's star thresholds (shown on pause menu)
- [ ] **Progress saves** — Complete a level → go back to menu → level should show earned stars
- [ ] **Next level unlocks** — Complete Level 1 → Level 2 should unlock
- [ ] **Next button works** — Click "Next Level" → should start the next level
- [ ] **Replay button works** — Click "Replay" → should restart the same level
- [ ] **Menu button works** — Click "Menu" → should return to start menu

### Level Failure
- [ ] **Fails when lives run out** — Die with 0 lives → Game Over screen should show (not Level Complete)
- [ ] **Fails when time runs out (before clearing)** — If time expires before all waves cleared → should complete with current score (not fail)

### Edge Cases
- [ ] **Can't click locked levels** `[V5 PASS]` — Locked levels should be disabled/unclickable
- [ ] **Level 50 has no "Next"** — Last level should only show Replay and Menu buttons (no Next)
- [ ] **Back button works** — Click "Back" from level select → returns to main menu

### Adventure Task File
- `tasks/adventure-mode-design.md`

---

## Gravity Wells Environmental Hazard (NEW — 2026-02-12)

**Note:** The GravityWell entity has been enhanced with blue/red variants, visual indicators, and pull mechanics. The game loop integration (wiring callbacks) needs to be done separately.

### What Was Changed
- Added blue wells (0x4488ff): pull force affects movement, non-lethal
- Added red wells (0xff4444): lethal within 0.5 radius inner zone
- Added translucent pull radius ring (becomes visible when activated)
- Added red danger zone ring for red wells
- Added `onPullPlayer` callback for active force application
- Added `onWellActivated` audio callback
- EnemySpawner now supports 'gravity_well_red' spawn type

### How to Test (once wired into game loop)

#### Basic Functionality
- [ ] **Blue wells spawn and appear correctly** — Should see blue concentric rings
- [ ] **Red wells spawn and appear correctly** — Should see red concentric rings
- [ ] **Wells activate on first hit** — Shoot a well. Should change to magenta color and show pull radius ring
- [ ] **Pull radius ring pulses** — Activated well should show pulsing translucent ring
- [ ] **Red wells show danger zone** — Red wells should have inner red ring when activated

#### Pull Mechanics
- [ ] **Blue wells pull player smoothly** — Walk near activated blue well. Should feel pulled toward center (smooth force, not instant teleport)
- [ ] **Pull strength increases when closer** — Force should be stronger near center, weaker at edge
- [ ] **No pull when outside radius** — Far from well = no effect
- [ ] **Blue wells don't kill** — Can touch blue well center without dying

#### Lethal Mechanics (Red Wells)
- [ ] **Red wells kill on close contact** — Get very close to activated red well center. Should die within danger zone
- [ ] **Red wells pull from distance** — Should still feel pull force from outside lethal radius
- [ ] **Death is immediate** — No gradual damage, instant kill in danger zone

#### Edge Cases
- [ ] **Wells work on all surfaces** — Test on sphere, cube, mobius, torus
- [ ] **Wells consume enemies** — Enemies pulled into well should be consumed (score added)
- [ ] **Wells detonate after 10 consumed** — Well should explode after consuming 10 enemies
- [ ] **Inactive wells don't pull** — Freshly spawned well (not shot yet) should drift but not pull

### Task File
- `tasks/gravity-wells-hazard.md` — Implementation details

---

## Visual Styles Consistency (NEW — 2026-02-12)

All "Sektori" visual styles renamed to include "Dark" in the name, and lighter variants added.

### Naming
- [ ] **Sektori Dark styles** — Open Visual Styles → all Sektori styles should have "Dark" suffix (e.g., "Sektori Cyan Dark", "Sektori Fire Dark")
- [ ] **Lighter Sektori variants exist** — Should see "Sektori Cyan", "Sektori Fire", "Sektori Ice", "Sektori Aurora" WITHOUT "Dark" suffix
- [ ] **Total preset count is 42** — Should see 42 visual style thumbnails (was 38 before)

### Visual Appearance
- [ ] **Dark variants are dark** — "Sektori Cyan Dark" should have very dim surface (mostly see grid + glow)
- [ ] **Light variants are lighter** — "Sektori Cyan" (no Dark) should have MORE visible surface (brighter, more opaque)
- [ ] **Same glow effect on both** — Both dark and light variants should have the same proximity tile glow

### Rendering Consistency
- [ ] **Playground preview matches demo** — Click a Sektori style thumbnail → preview should look the same as the playable demo
- [ ] **Demo matches main game** — Apply a Sektori style → start a game → surface opacity and glow should match the demo
- [ ] **All 4 light variants work** — Test Cyan, Fire, Ice, Aurora light variants → all should render correctly with visible surface

### Task File
- `tasks/visual-styles-consistency.md`

---

## Custom Mesh Loading (NEW — 2026-02-13)

**New feature:** Load custom 3D models (.obj, .glb, .gltf) as playable surfaces. Comprehensive documentation in `docs/CUSTOM_MAPS.md` (user guide) and `docs/DEV_CUSTOM_MESHES.md` (developer guide).

### File Loading & Parsing

- [ ] **Load cup.obj via file picker** — Click START GAME → select Mode → "LOAD CUSTOM MAP" → choose `public/meshes/cup.obj` → game starts on custom mesh (player visible on surface)
- [ ] **Load torus.obj via file picker** — Load `public/meshes/torus.obj` → game starts on torus surface
- [ ] **Load bunny.obj via file picker** — Load `public/meshes/bunny.obj` → game starts on bunny-shaped surface
- [ ] **Load sphere-simple.obj via file picker** — Load `public/meshes/sphere-simple.obj` → works like built-in sphere
- [ ] **Load knot.obj via file picker** — Load `public/meshes/knot.obj` → complex topology, enemies move correctly

### Geometry & Movement

- [ ] **Player spawns on surface** — After loading custom mesh, player should be visible on the surface, not inside or floating above
- [ ] **Player can move** — Use WASD to move. Player should move smoothly on the custom mesh in all directions
- [ ] **Enemies spawn on surface** — Enemies should appear on the custom mesh surface, not floating or stuck
- [ ] **Enemies move smoothly** — Enemies should move around the mesh surface without getting stuck, clipping, or teleporting
- [ ] **Diagonal movement works** — Press W+D → player should move in smooth diagonal arc on custom mesh
- [ ] **Camera follows player** — Camera should orient to player's surface normal (not always pointing up), rotate smoothly as player moves

### Error Handling & Edge Cases

- [ ] **Load invalid file (test.txt)** — Attempt to load a text file. Should show error message: "Unsupported file type" or similar. Game should NOT crash
- [ ] **Load empty file** — Create an empty file named `empty.obj`, try to load. Should show error "No mesh geometry found". Game should NOT crash
- [ ] **Load non-existent file** — Try loading a file that doesn't exist. Should show error. Game should NOT crash
- [ ] **File too large (150k+ triangles)** — Create a mesh with >100k triangles, try to load. Should show error "Mesh too large: XXX triangles (max: 100,000)". Game should NOT crash
- [ ] **Drag-and-drop loads file** — (If enabled) Drag a .glb file onto the game window. Should load and start game
- [ ] **Corrupted mesh file** — Try loading a broken/corrupted .glb file. Should show error, not crash

### Gameplay On Custom Meshes

- [ ] **Gameplay is playable** — Game is fully playable on custom mesh (not unplayably difficult or broken)
- [ ] **Scoring works** — Kill enemies, score should increase normally
- [ ] **Weapons work** — Shoot at enemies on custom mesh. Bullets should hit correctly (not miss or curve wrong)
- [ ] **UI is visible** — Score, kill log, minimap (if enabled) should be visible and work correctly
- [ ] **Mode selection works** — Try different game modes (Waves, King, etc.) on custom mesh. All modes should work
- [ ] **Can pause** — Press ESC to pause. Should show pause menu. Resume should work

### Performance

- [ ] **Cup.obj loads fast** — (~2k triangles) Should load in <1 second
- [ ] **Bunny.obj loads reasonably** — (~25k triangles) Should load in ~1–3 seconds, no excessive lag during load
- [ ] **Game runs at 60 FPS on small mesh** — Cup or torus should maintain 60 FPS throughout gameplay (check DevTools Performance tab)
- [ ] **Game is playable on larger mesh** — Bunny (25k triangles) should run at 30–60 FPS (acceptable variance)
- [ ] **No frame stutters on spawn** — When enemies spawn or mesh first loads, FPS should not spike or drop sharply

### Multi-Mesh / Animation (if supported)

- [ ] **Animated mesh loads** — (If animated GLB exists) Load an animated mesh. Animation should play smoothly
- [ ] **Player follows animated surface** — Player should stay on the mesh even as it animates
- [ ] **Enemies work on animated mesh** — Enemies should spawn and move on animated mesh

### Visual Appearance

- [ ] **Mesh is visible** — Custom mesh should be visible in-game (rendered with semi-transparent material like built-in surfaces)
- [ ] **Mesh color is consistent** — All custom meshes use same visual style (semi-transparent dark purple)
- [ ] **UV grid is visible** — (If enabled in debug) UV grid overlay should show longitude/latitude lines on custom mesh
- [ ] **Mesh is properly scaled** — Custom mesh should be similar size to built-in surfaces (not tiny or huge)

### Multiplayer (if applicable)

- [ ] **Custom mesh works in co-op** — Load custom mesh in split-screen mode. Both players should see the same mesh, move correctly
- [ ] **Custom mesh works in LAN** — (If LAN enabled) Host game with custom mesh, join from another computer. Both players see mesh
- [ ] **Multiplayer is smooth** — No lag spikes or desync compared to built-in surfaces

### Documentation

- [ ] **User guide is helpful** — Read `docs/CUSTOM_MAPS.md`. Can you understand how to load a custom map? Is the guide clear?
- [ ] **Sample meshes are accessible** — Are the included sample meshes easy to find and load?
- [ ] **Error messages match docs** — When an error occurs, does the message match the troubleshooting guide in `docs/CUSTOM_MAPS.md`?

### Task File
- `tasks/custom-object-loader-s13-phase6-docs.md` — Phase 6 documentation and polish

---

## How to Report Failures

When something fails, write a note here with:
1. **Which checkbox** failed
2. **What you saw** (exact behavior)
3. **What you expected**
4. **Browser + OS** (Chrome 120 on Windows 11, etc.)

Claude will read this file at the start of each session and prioritize fixing reported failures.

### Failure Notes
<!-- Add failure notes below this line -->


---

## Capsule/Pill Oscillation Fix (s23-unified-movement-fix) — 2026-02-18

- [V5 PASS] **Capsule map: movement is smooth** — Select Capsule map, hold W for 8s. Player should move continuously without oscillation. Previously oscillationRatio=0.327 (FAIL). Now: 0.000 (PASS).
- [V5 PASS] **Pill map: movement is smooth** — Select Pill map, hold W for 8s. Previously oscillationRatio=0.500 (FAIL). Now: 0.000 (PASS).
- [V5 PASS] **All 13/13 surfaces pass the movement audit** — Puppeteer audit confirms all surfaces now have oscillationRatio=0.000 (or near zero for sphere-tunnel=0.024).
- [ ] **Capsule: no jitter at cap poles** — Move player to the very bottom/top of the capsule hemisphere. Movement should be smooth without position jumps.
- [ ] **Pill: same pole test** — Same as above for pill.

**Root cause fixed:** `FaceWalker._computeEntryBary()` used `eps=0.1` as the entry nudge after crossing an edge. This added ~0.09×triangle_height extra world displacement per crossing (discontinuous, untracked). At the cap-cylinder junction, each crossing nudged the player alternately toward the cylinder (+y) and back to the cap (-y), causing oscillation. Fixed by reducing `eps=0.1→0.005` (5× the vertex detection epsilon of 0.001, so no vertex detection issues).

**Puppeteer audit:** 13/13 PASS (was 11/13). Reports saved in `reports/s23-movement-audit-*.html`.
**Regression test:** `src/test/capsule-pill-regression.test.ts` — passes ✅

---

## Half-Resolution Bloom (s24-perf-01-half-resolution-bloom) — 2026-02-19

- [ ] **Bloom glow is still visible** — Play for 30 seconds on any map. Neon glow/bloom should be clearly visible on enemies, bullets, and the player. Should NOT look flat or unlit.
- [ ] **Bloom is not obviously blocky or pixelated** — The glow effect should look soft and smooth, not pixelated. (Half-res bloom may be very slightly softer — this is acceptable and hard to notice.)
- [ ] **No visual artifacting on resize** — Resize the browser window. Bloom should remain correct after resize (no half-size render frozen on screen).
- [ ] **FPS improved vs. previous session** — If you have a baseline FPS reading (F3 overlay), verify it is equal or better than before. Expected improvement: significant on GPU-bound hardware.

**What changed:** `EffectComposer` now runs at 50% of window resolution (e.g., 960×540 instead of 1920×1080) for bloom+vignette post-processing, then upscales to full res for final output. Bloom is inherently blurry so the quality difference is imperceptible while GPU pixel fill is reduced 4×.

**Regression test:** `src/rendering/BloomResolution.test.ts` — 4/4 PASS ✅

---

## Pill Movement Fix (s22-pill-movement-broken-v3) — 2026-02-18

- [ ] **Pill map: forward movement is straight** — Select Pill map, move with W. Trail should be a smooth arc curving around the pill. **Regression**: before fix, the trail was a saw-tooth zigzag, reversing direction every ~5 frames near the south seam.
- [ ] **Pill map: movement doesn't stutter at south pole** — Press W for 3+ seconds near the bottom of the pill. Player should move continuously without reversing or stuttering.
- [ ] **All other maps unaffected** — Sphere, Cube, Icosahedron maps all move smoothly (no regressions from tightening vertex detection epsilon 0.05→0.001).

**Root cause fixed:** `FaceWalker.ts` atVertex detection epsilon was 0.05 — too large. When exiting a triangle near (but not at) a vertex (v≈0.004 < 0.05), the wrong adjacent face was selected with a mismatched alpha, causing position jumps and direction reversals. Fix: tightened epsilon to 0.001.

**Regression test:** `src/test/pill-movement-regression.test.ts` — passes ✅

---

## Geometry Sharing + Mobile Tiers (s24-perf-08-geometry-material-sharing) — 2026-02-19

### Geometry sharing (desktop):
- [ ] **Game runs without crashes** — Play for 60+ seconds. No black screen, no errors in console related to geometry disposal or shared buffers.
- [ ] **Projectile weapons still look correct** — Fire Spread (cyan spheres), Homing (cone), PlasmaMortar (green sphere), GravityGun (torus). All should appear at correct sizes.
- [ ] **BlackHole and Tesla weapons still look correct** — BlackHole shows purple sphere; Tesla Coil shows large wireframe sphere around player.
- [ ] **Weapon pickups still appear** — Pick up any weapon. Rotating octahedron pickup (outer wireframe + inner solid) should appear on the map.
- [ ] **SuperState pickups still appear** — Dot pattern pickups should appear and disappear as you collect dots.

### Mobile tier (test with `?mobile=true` URL parameter):
- [ ] **Mobile mode loads without error** — Add `?mobile=true` to the URL and load the game. Should run, no console errors.
- [ ] **Enemies further away switch to simplified geometry sooner** — At default zoom, distant enemies should appear as low-poly shapes (icosahedron/billboard) while close enemies show full detail. This should be more aggressive than desktop (half the threshold distances).
- [ ] **No glow trails on mobile** — Fast enemies (Mayfly, Rocket, Duck) should NOT have trailing glow effects in mobile mode. On desktop they do.
- [ ] **Particle effects are present but lighter** — Explosions and death particles should still appear, but fewer per event than desktop.

**What changed:**
- Shared geometry cache (`src/rendering/GeometryCache.ts`) — projectile geometries created ONCE, reused across all instances.
- WeaponManager, WeaponPickup, SuperStatePickup updated to use shared geometries.
- Mobile: LOD distances halved (highDistance 60→30, mediumDistance 120→60) — more aggressive LOD on mobile.
- Mobile: Glow trails disabled.
- Mobile: Particle budget pre-set to MEDIUM (60/frame vs 200/frame on desktop).

**Regression test:** `src/rendering/GeometryCache.test.ts` — passes ✅
