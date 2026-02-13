# Human Test Checklist

> **What is this?** Everything Claude has changed that needs YOU to verify in a real browser. Items are grouped by system. Check them off as you go. If something fails, note what happened — Claude will read this file next session.
>
> **Last updated:** 2026-02-12
>
> **Visual Test Results (2026-02-12, commit a722f6a):** Headless Puppeteer + SwiftShader testing completed. Items marked `[V5 PASS]` were verified visually at Level 5. Items marked `[V5 INCONCLUSIVE]` could not be tested headless (need real browser). See `tasks/visual-test-human-todos.md` and `tasks/lan-visual-testing.md` for full details.

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

### LAN Connection (V5 PASS — verified 2026-02-12)
- [x] **Host game flow works** — LAN -> HOST GAME -> surface select -> START HOSTING -> ENTER GAME
- [x] **Join game flow works** — LAN -> lobby discovers hosted game -> click to join
- [x] **Both players render** — Both player characters visible on sphere with name labels
- [x] **Enemies spawn in LAN** — Grunts appear and move
- [x] **Score tracking works** — Host scored 100 points, kill log shows "Grunt x2"
- [x] **No console errors** — 0 critical errors on either page

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

## Performance (commits `07aee82`, `a960932`)

- [ ] **No FPS crater at high scores** `[V5 INCONCLUSIVE - SwiftShader]` — Play until 450M+ score. FPS should stay above 30
- [ ] **Explosion particles don't tank FPS** `[V5 INCONCLUSIVE - SwiftShader]` — Chain explosions (many enemies dying at once) should not drop below 30fps
- [ ] **Performance graphs work** `[V5 PASS]` — Pause menu → Performance → graphs should display data

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

